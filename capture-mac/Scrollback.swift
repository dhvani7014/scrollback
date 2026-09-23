// Scrollback capture tool (macOS 13+).
//
// Captures your screen (or one window) with ScreenCaptureKit, OCRs it with Vision,
// encrypts every frame with AES-256-GCM, and streams it to the relay.
// The viewer link carries the key in the URL fragment, so the relay never sees it.
//
// Build:  ./build.sh        Run:  ./scrollback --relay https://your-relay.example
//
// NOTE: written without access to a Mac toolchain. If the compiler complains, the fix
// is almost certainly a one-line API signature tweak — see README "If it doesn't compile".

import Foundation
import AppKit
import CoreImage
import CoreMedia
import CoreVideo
import CryptoKit
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers
import Vision

// MARK: - Small helpers

struct Fail: Error, CustomStringConvertible {
    let description: String
    init(_ d: String) { description = d }
}

func log(_ s: String) { FileHandle.standardError.write(Data((s + "\n").utf8)) }

func b64url(_ d: Data) -> String {
    d.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

func randomToken(bytes n: Int) -> String {
    var b = [UInt8](repeating: 0, count: n)
    _ = SecRandomCopyBytes(kSecRandomDefault, n, &b)
    return b64url(Data(b))
}

func round5(_ v: CGFloat) -> Double { (Double(v) * 100_000).rounded() / 100_000 }

// MARK: - Options

struct Options {
    var relay = "http://localhost:8787"
    var fps = 2.0
    var session: String? = nil
    var windowQuery: String? = nil
    var displayIndex = 0
    var list = false
    var jpegWidth = 1600
    var jpegQuality = 0.6
}

func parseArgs() -> Options {
    var o = Options()
    var it = CommandLine.arguments.dropFirst().makeIterator()
    while let a = it.next() {
        switch a {
        case "--relay": if let v = it.next() { o.relay = v.hasSuffix("/") ? String(v.dropLast()) : v }
        case "--fps": if let v = it.next(), let d = Double(v) { o.fps = min(5, max(0.5, d)) }
        case "--session": o.session = it.next()
        case "--window": o.windowQuery = it.next()
        case "--display": if let v = it.next(), let i = Int(v) { o.displayIndex = max(0, i) }
        case "--jpeg-width": if let v = it.next(), let i = Int(v) { o.jpegWidth = max(640, i) }
        case "--list": o.list = true
        case "-h", "--help":
            print("""
            scrollback — live, selectable, scroll-back-able copy of your screen

              --relay URL       relay base URL (default http://localhost:8787)
              --fps N           capture rate, 0.5–5 (default 2)
              --window TEXT     capture one window whose app/title contains TEXT
              --display N       display index when capturing a whole screen (default 0)
              --session ID      reuse a session id (8–64 chars of A-Z a-z 0-9 _ -)
              --jpeg-width N    max width of the image sent to viewers (default 1600)
              --list            list displays and windows, then exit
            """)
            exit(0)
        default: log("ignoring unknown argument \(a)")
        }
    }
    return o
}

// MARK: - Data model (matches viewer/viewer.js)

struct Line: Codable {
    var t: String
    var x: Double
    var y: Double
    var w: Double
    var h: Double
    var minY: Double { y }
    var maxY: Double { y + h }
}

struct FramePayload: Codable {
    var w: Int
    var h: Int
    var jpeg: String
    var lines: [Line]
}

// MARK: - Change detection (tile grid)
// The screen is shrunk to 640x360 grey and split into 20x12 tiles. A tile "changed" when the
// summed absolute pixel difference against the baseline exceeds a threshold. Only the band of
// rows that changed gets re-OCR'd; unchanged lines are reused.

final class ChangeDetector {
    let cols = 20, rows = 12, dw = 640, dh = 360
    let sadThreshold = 600
    private var baseline: [UInt8]? = nil

    private func downsample(_ img: CGImage) -> [UInt8]? {
        var buf = [UInt8](repeating: 0, count: dw * dh)
        let ok: Bool = buf.withUnsafeMutableBytes { p in
            guard let ctx = CGContext(
                data: p.baseAddress, width: dw, height: dh, bitsPerComponent: 8,
                bytesPerRow: dw, space: CGColorSpaceCreateDeviceGray(),
                bitmapInfo: CGImageAlphaInfo.none.rawValue
            ) else { return false }
            ctx.interpolationQuality = .medium
            ctx.draw(img, in: CGRect(x: 0, y: 0, width: dw, height: dh))
            return true
        }
        return ok ? buf : nil
    }

    /// Returns (number of changed tiles, first changed row, last changed row). Resets the
    /// baseline only when something changed, so slow fades still accumulate to a trigger.
    func update(_ img: CGImage) -> (count: Int, minRow: Int, maxRow: Int, first: Bool) {
        guard let cur = downsample(img) else { return (0, 0, 0, false) }
        guard let base = baseline else {
            baseline = cur
            return (cols * rows, 0, rows - 1, true)
        }
        let tw = dw / cols, th = dh / rows
        var count = 0, minRow = rows, maxRow = -1
        for r in 0..<rows {
            for c in 0..<cols {
                var sad = 0
                for y in (r * th)..<((r + 1) * th) {
                    let rowStart = y * dw
                    for x in (c * tw)..<((c + 1) * tw) {
                        sad += abs(Int(cur[rowStart + x]) - Int(base[rowStart + x]))
                    }
                }
                if sad > sadThreshold {
                    count += 1
                    minRow = min(minRow, r)
                    maxRow = max(maxRow, r)
                }
            }
        }
        if count > 0 { baseline = cur }
        return (count, minRow, maxRow, false)
    }
}

// MARK: - OCR

func recognize(_ img: CGImage) -> [Line] {
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = false   // code, URLs and paths: don't "fix" them
    req.recognitionLanguages = ["en-US"]
    let handler = VNImageRequestHandler(cgImage: img, options: [:])
    do { try handler.perform([req]) } catch { return [] }
    let observations = req.results ?? []
    return observations.compactMap { o -> Line? in
        guard let cand = o.topCandidates(1).first else { return nil }
        let text = cand.string.trimmingCharacters(in: .whitespaces)
        if text.isEmpty { return nil }
        let b = o.boundingBox  // normalised, origin bottom-left
        return Line(t: text, x: round5(b.minX), y: round5(1 - b.maxY), w: round5(b.width), h: round5(b.height))
    }
}

func sortLines(_ lines: [Line]) -> [Line] {
    lines.sorted { a, b in
        // same visual row (centres within half a line height) -> left to right
        let ca = a.y + a.h / 2, cb = b.y + b.h / 2
        if abs(ca - cb) < min(a.h, b.h) * 0.5 { return a.x < b.x }
        return ca < cb
    }
}

// MARK: - JPEG

func jpegData(_ img: CGImage, maxWidth: Int, quality: Double) -> (Data, Int, Int)? {
    var out = img
    if img.width > maxWidth {
        let nw = maxWidth
        let nh = max(1, img.height * maxWidth / img.width)
        guard let ctx = CGContext(
            data: nil, width: nw, height: nh, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
        ) else { return nil }
        ctx.interpolationQuality = .high
        ctx.draw(img, in: CGRect(x: 0, y: 0, width: nw, height: nh))
        guard let scaled = ctx.makeImage() else { return nil }
        out = scaled
    }
    let data = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(dest, out, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
    guard CGImageDestinationFinalize(dest) else { return nil }
    return (data as Data, out.width, out.height)
}

// MARK: - Relay connection

final class Relay {
    private let url: URL
    private var task: URLSessionWebSocketTask?
    private let urlSession = URLSession(configuration: .default)
    private let lock = NSLock()
    private var inFlight = 0
    private var retry = 0

    init(url: URL) { self.url = url }

    func connect() {
        let t = urlSession.webSocketTask(with: url)
        t.maximumMessageSize = 16 * 1024 * 1024
        lock.lock(); task = t; inFlight = 0; lock.unlock()
        t.resume()
        listen(t)
        log("relay: connecting…")
    }

    private func listen(_ t: URLSessionWebSocketTask) {
        t.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let msg):
                self.retry = 0
                if case .string(let s) = msg,
                   let obj = try? JSONSerialization.jsonObject(with: Data(s.utf8)) as? [String: Any],
                   obj["type"] as? String == "viewers", let n = obj["count"] as? Int {
                    log("viewers: \(n)")
                }
                self.listen(t)
            case .failure(let err):
                log("relay: disconnected (\(err.localizedDescription)); retrying")
                self.reconnect()
            }
        }
    }

    private func reconnect() {
        retry += 1
        let delay = min(10.0, 0.5 * pow(2.0, Double(min(retry, 5))))
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in self?.connect() }
    }

    /// Drops the frame (returns false) if two sends are already in flight (slow uplink).
    @discardableResult
    func send(_ text: String, droppable: Bool = true) -> Bool {
        lock.lock()
        guard let t = task, !(droppable && inFlight >= 2) else { lock.unlock(); return false }
        inFlight += 1
        lock.unlock()
        t.send(.string(text)) { [weak self] err in
            guard let self = self else { return }
            self.lock.lock(); self.inFlight = max(0, self.inFlight - 1); self.lock.unlock()
            if err != nil { /* receive() will notice the dead socket and reconnect */ }
        }
        return true
    }
}

// MARK: - Frame pipeline

final class Pipeline {
    let opts: Options
    let relay: Relay
    let key: SymmetricKey
    let detector = ChangeDetector()
    private var lines: [Line] = []
    private var lastSig = ""
    private var lastFullOCR = Date.distantPast
    private var sent = 0
    private var lastSent = Date.distantPast

    init(opts: Options, relay: Relay, key: SymmetricKey) {
        self.opts = opts; self.relay = relay; self.key = key
    }

    func handle(_ img: CGImage) {
        let change = detector.update(img)
        if change.count == 0 { return }

        let needFull = change.first
            || Date().timeIntervalSince(lastFullOCR) > 10
            || Double(change.maxRow - change.minRow + 1) / Double(detector.rows) > 0.6

        if needFull {
            lines = sortLines(recognize(img))
            lastFullOCR = Date()
        } else {
            // Band of changed rows, widened until it fully contains any line it touches.
            var y0 = Double(change.minRow) / Double(detector.rows)
            var y1 = Double(change.maxRow + 1) / Double(detector.rows)
            var grew = true
            while grew {
                grew = false
                for l in lines where l.maxY > y0 && l.minY < y1 {
                    if l.minY < y0 { y0 = l.minY; grew = true }
                    if l.maxY > y1 { y1 = l.maxY; grew = true }
                }
            }
            y0 = max(0, y0 - 0.004); y1 = min(1, y1 + 0.004)
            let pxTop = Int((y0 * Double(img.height)).rounded(.down))
            let pxBottom = Int((y1 * Double(img.height)).rounded(.up))
            let rect = CGRect(x: 0, y: pxTop, width: img.width, height: max(1, pxBottom - pxTop))
            if let crop = img.cropping(to: rect) {
                let bandH = Double(rect.height) / Double(img.height)
                let fresh = recognize(crop).map { l -> Line in
                    Line(t: l.t, x: l.x,
                         y: round5(CGFloat(y0 + l.y * bandH)),
                         w: l.w, h: round5(CGFloat(l.h * bandH)))
                }
                let kept = lines.filter { !($0.maxY > y0 && $0.minY < y1) }
                lines = sortLines(kept + fresh)
            }
        }

        // Send when the text changed, or when enough of the picture changed (slides, images).
        // Text changes go out immediately. Picture-only changes (video, animation, webcam) are
        // throttled to one frame per 4 s, otherwise a playing video would fill the relay's
        // scrollback history within a couple of minutes.
        let sig = lines.map { $0.t }.joined(separator: "\n")
        let textChanged = sig != lastSig
        let visualOnly = change.count >= 3 && Date().timeIntervalSince(lastSent) > 4
        guard textChanged || visualOnly else { return }
        lastSig = sig

        guard let (jpg, w, h) = jpegData(img, maxWidth: opts.jpegWidth, quality: opts.jpegQuality) else { return }
        let payload = FramePayload(w: w, h: h, jpeg: jpg.base64EncodedString(), lines: lines)
        guard let plain = try? JSONEncoder().encode(payload),
              let sealed = try? AES.GCM.seal(plain, using: key),
              let combined = sealed.combined else { return }   // nonce(12) || ciphertext || tag
        let envelope = "{\"type\":\"frame\",\"blob\":\"\(combined.base64EncodedString())\"}"
        if relay.send(envelope) {
            sent += 1
            lastSent = Date()
            // No per-frame logging: if this terminal is on the captured screen, every log line
            // would change the screen and trigger another frame (a feedback loop).
            if sent == 1 { log("streaming: first frame sent (\(lines.count) lines, \(jpg.count / 1024) KB)") }
        }
    }
}

// MARK: - ScreenCaptureKit glue

final class Capturer: NSObject, SCStreamOutput, SCStreamDelegate {
    private let ciContext = CIContext()
    private let workQueue = DispatchQueue(label: "scrollback.work", qos: .userInitiated)
    let sampleQueue = DispatchQueue(label: "scrollback.samples", qos: .userInitiated)
    private let lock = NSLock()
    private var busy = false
    var onImage: ((CGImage) -> Void)?

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sampleBuffer.isValid else { return }
        // Skip idle/blank frames: only frames with status == .complete carry pixels.
        guard let atts = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false)
                as? [[SCStreamFrameInfo: Any]],
              let raw = atts.first?[.status] as? Int,
              SCFrameStatus(rawValue: raw) == .complete,
              let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        lock.lock(); if busy { lock.unlock(); return }; busy = true; lock.unlock()
        let ci = CIImage(cvPixelBuffer: pixels)
        guard let cg = ciContext.createCGImage(ci, from: ci.extent) else {
            lock.lock(); busy = false; lock.unlock(); return
        }
        workQueue.async { [weak self] in
            self?.onImage?(cg)
            self?.lock.lock(); self?.busy = false; self?.lock.unlock()
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        log("capture stopped: \(error.localizedDescription)")
        exit(1)
    }
}

// MARK: - Main

var keepAlive: [AnyObject] = []

func run(_ o: Options) async throws {
    if !CGPreflightScreenCaptureAccess() {
        _ = CGRequestScreenCaptureAccess()
        log("""
        Screen Recording permission is needed. Open System Settings → Privacy & Security →
        Screen & System Audio Recording, enable your terminal app, then re-run this command.
        """)
    }
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)

    if o.list {
        print("Displays:")
        for (i, d) in content.displays.enumerated() { print("  [\(i)] \(d.width)x\(d.height) pt (id \(d.displayID))") }
        print("Windows:")
        for w in content.windows where w.isOnScreen && !(w.title ?? "").isEmpty {
            print("  \(w.owningApplication?.applicationName ?? "?") — \(w.title ?? "")")
        }
        exit(0)
    }

    let filter: SCContentFilter
    var pw: Int, ph: Int
    if let q = o.windowQuery {
        guard let win = content.windows.first(where: {
            $0.isOnScreen && "\($0.owningApplication?.applicationName ?? "") \($0.title ?? "")".localizedCaseInsensitiveContains(q)
        }) else { throw Fail("no on-screen window matches “\(q)” (try --list)") }
        filter = SCContentFilter(desktopIndependentWindow: win)
        // ScreenCaptureKit reports the point->pixel scale itself. (NSScreen aborts in a CLI tool
        // with no window-server connection: "did_initialize" assertion.)
        var scale: CGFloat = 2
        if #available(macOS 14.0, *) { scale = CGFloat(filter.pointPixelScale) }
        pw = Int(win.frame.width * scale); ph = Int(win.frame.height * scale)
        log("capturing window: \(win.owningApplication?.applicationName ?? "?") — \(win.title ?? "")")
    } else {
        guard !content.displays.isEmpty else { throw Fail("no displays found") }
        let d = content.displays[min(o.displayIndex, content.displays.count - 1)]
        filter = SCContentFilter(display: d, excludingWindows: [])
        pw = CGDisplayPixelsWide(d.displayID); ph = CGDisplayPixelsHigh(d.displayID)
        if pw == 0 || ph == 0 { pw = d.width * 2; ph = d.height * 2 }
        log("capturing display \(o.displayIndex)")
    }
    if pw > 2560 { ph = ph * 2560 / pw; pw = 2560 }

    let cfg = SCStreamConfiguration()
    cfg.width = max(2, pw); cfg.height = max(2, ph)
    cfg.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(max(1, Int((o.fps).rounded()))))
    if o.fps < 1 { cfg.minimumFrameInterval = CMTime(value: 2, timescale: 1) }
    cfg.pixelFormat = kCVPixelFormatType_32BGRA
    cfg.showsCursor = true
    cfg.queueDepth = 3

    // Crypto + relay
    let key = SymmetricKey(size: .bits256)
    let keyB64 = key.withUnsafeBytes { b64url(Data($0)) }
    let session = o.session ?? randomToken(bytes: 9)
    let token = randomToken(bytes: 16)
    let wsBase = o.relay.replacingOccurrences(of: "https://", with: "wss://").replacingOccurrences(of: "http://", with: "ws://")
    guard let wsURL = URL(string: "\(wsBase)/ws/\(session)?role=presenter&pt=\(token)") else { throw Fail("bad --relay URL") }

    let relay = Relay(url: wsURL)
    relay.connect()
    let pipeline = Pipeline(opts: o, relay: relay, key: key)

    let capturer = Capturer()
    capturer.onImage = { pipeline.handle($0) }
    let stream = SCStream(filter: filter, configuration: cfg, delegate: capturer)
    try stream.addStreamOutput(capturer, type: .screen, sampleHandlerQueue: capturer.sampleQueue)
    try await stream.startCapture()
    keepAlive = [relay, pipeline, capturer, stream]

    // keep the socket warm (a dispatch timer works under dispatchMain(); Timer would not)
    let pinger = DispatchSource.makeTimerSource(queue: .main)
    pinger.schedule(deadline: .now() + 20, repeating: 20)
    pinger.setEventHandler { relay.send("{\"type\":\"ping\"}", droppable: false) }
    pinger.resume()
    keepAlive.append(pinger as AnyObject)

    print("""

    ──────────────────────────────────────────────────────────
     Share this link with viewers:

       \(o.relay)/s/\(session)#k=\(keyB64)

     Anyone with the whole link can read your screen. The part after # never
     leaves their browser and is not known to the relay. Ctrl+C to stop.
    ──────────────────────────────────────────────────────────

    """)
}

// Window capture needs a window-server connection, which a bare CLI process lacks until
// something opens one (otherwise: "Assertion failed: (did_initialize) CGS_REQUIRE_INIT").
// Touching NSApplication.shared opens it. No Dock icon appears for a non-bundled tool.
_ = NSApplication.shared
NSApplication.shared.setActivationPolicy(.prohibited)
signal(SIGINT) { _ in print("\nstopped."); exit(0) }
let options = parseArgs()
Task {
    do { try await run(options) } catch { log("error: \(error)"); exit(1) }
}
dispatchMain()
