import Foundation
import ImageIO
import UIKit

/// Team logos for the Live Activity. A widget cannot download images, so the app saves them into a
/// folder both can read (an App Group) and the widget loads them from there. If the App Group is
/// not set up, or a logo has not been downloaded yet, everything here returns nil and the widget
/// draws the team's color with its emoji or abbreviation instead, so nothing breaks.
///
/// Compiled into BOTH the app and the PropLeagueLiveActivity extension.
enum LogoCache {
    static let groupId = "group.com.propleague.app"

    static var directory: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: groupId)?
            .appendingPathComponent("logos", isDirectory: true)
    }

    /// A stable name for a URL (djb2). Swift's own hashValue changes between launches, so it cannot
    /// be used to find the same file from the app and from the extension.
    static func fileName(for url: String) -> String {
        var hash: UInt64 = 5381
        for byte in url.utf8 { hash = (hash &* 33) &+ UInt64(byte) }
        return String(hash, radix: 16) + ".v2.img"
    }

    static func fileURL(for url: String) -> URL? {
        directory?.appendingPathComponent(fileName(for: url))
    }

    /// The cached logo, or nil.
    static func image(for url: String) -> UIImage? {
        guard !url.isEmpty, let path = fileURL(for: url)?.path else { return nil }
        return UIImage(contentsOfFile: path)
    }

    /// A small PNG copy of the image. A widget has a tight memory limit, and drawing a full-size
    /// upload (a few thousand pixels square) can fail silently and leave a blank circle, so only a
    /// 192px version is saved (a 44pt badge at 3x is 132px).
    static func downsampled(_ data: Data, maxPixel: Int = 192) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: cg).pngData()
    }

    /// Downloads any logo not cached yet, or cached more than a day ago (a re-uploaded logo keeps
    /// its URL). Returns true if a file was written, so the caller can refresh the activity.
    @discardableResult
    static func prefetch(_ urls: [String]) async -> Bool {
        guard let dir = directory else { return false }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var wroteAny = false
        for raw in Set(urls) where !raw.isEmpty {
            guard let remote = URL(string: raw), let local = fileURL(for: raw) else { continue }
            if let attrs = try? FileManager.default.attributesOfItem(atPath: local.path),
               let modified = attrs[.modificationDate] as? Date,
               Date().timeIntervalSince(modified) < 24 * 60 * 60 {
                continue
            }
            do {
                let (data, response) = try await URLSession.shared.data(from: remote)
                guard (response as? HTTPURLResponse)?.statusCode == 200, let small = downsampled(data) else { continue }
                try small.write(to: local, options: .atomic)
                wroteAny = true
            } catch {
                continue
            }
        }
        return wroteAny
    }
}
