import SwiftUI
import WebKit
import UIKit

private enum FrostlyConfig {
    static let siteURL = URL(string: "https://wahm-social.onrender.com")!
    static let allowedHosts: Set<String> = [
        "wahm-social.onrender.com",
        "frostly-53686.firebaseapp.com"
    ]
    static let background = UIColor(red: 7 / 255, green: 10 / 255, blue: 22 / 255, alpha: 1)
}

@MainActor
final class BrowserState: ObservableObject {
    @Published var canGoBack = false
    @Published var canGoForward = false
    @Published var isLoading = true
    @Published var hasError = false
    @Published var showShareSheet = false
    @Published var shareItem: Any?

    weak var webView: WKWebView?

    func syncNavigationState() {
        canGoBack = webView?.canGoBack ?? false
        canGoForward = webView?.canGoForward ?? false
    }

    func shareCurrentPage() {
        shareItem = webView?.url ?? FrostlyConfig.siteURL
        showShareSheet = true
    }

    func shareDownloadedFile(at url: URL) {
        shareItem = url
        showShareSheet = true
    }
}

struct ContentView: View {
    @StateObject private var browser = BrowserState()

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                FrostlyWebView(state: browser)
                    .background(Color(uiColor: FrostlyConfig.background))

                if browser.hasError {
                    connectionError
                }
            }
            .overlay(alignment: .top) {
                if browser.isLoading {
                    ProgressView()
                        .progressViewStyle(.linear)
                        .tint(Color(red: 0.36, green: 0.76, blue: 1.0))
                        .frame(height: 2)
                }
            }

            navigationBar
        }
        .background(Color(uiColor: FrostlyConfig.background))
        .preferredColorScheme(.dark)
        .sheet(isPresented: $browser.showShareSheet, onDismiss: {
            browser.shareItem = nil
        }) {
            if let item = browser.shareItem {
                FrostlyShareSheet(items: [item])
            }
        }
    }

    private var connectionError: some View {
        VStack(spacing: 16) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 42, weight: .medium))
                .foregroundStyle(Color(red: 0.36, green: 0.76, blue: 1.0))

            Text("ما قدرنا نتصل بفروستلي")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(.white)

            Text("تأكد من اتصال الإنترنت وحاول مرة ثانية.")
                .font(.system(size: 15))
                .foregroundStyle(.white.opacity(0.7))
                .multilineTextAlignment(.center)

            Button {
                browser.hasError = false
                browser.isLoading = true
                browser.webView?.load(URLRequest(url: FrostlyConfig.siteURL))
            } label: {
                Label("إعادة المحاولة", systemImage: "arrow.clockwise")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color(red: 0.02, green: 0.05, blue: 0.12))
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .background(Color(red: 0.36, green: 0.76, blue: 1.0), in: Capsule())
            }
            .padding(.top, 4)
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: FrostlyConfig.background))
    }

    private var navigationBar: some View {
        HStack(spacing: 0) {
            Button {
                browser.webView?.goBack()
            } label: {
                Image(systemName: "arrow.backward")
                    .frame(maxWidth: .infinity)
            }
            .disabled(!browser.canGoBack)
            .accessibilityLabel("رجوع")

            Button {
                browser.webView?.goForward()
            } label: {
                Image(systemName: "arrow.forward")
                    .frame(maxWidth: .infinity)
            }
            .disabled(!browser.canGoForward)
            .accessibilityLabel("تقدم")

            Text("Frostly")
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .accessibilityLabel("فروستلي")

            Button {
                browser.webView?.reload()
            } label: {
                Image(systemName: "arrow.clockwise")
                    .frame(maxWidth: .infinity)
            }
            .accessibilityLabel("تحديث الصفحة")

            Button {
                browser.shareCurrentPage()
            } label: {
                Image(systemName: "square.and.arrow.up")
                    .frame(maxWidth: .infinity)
            }
            .accessibilityLabel("مشاركة")
        }
        .font(.system(size: 17, weight: .medium))
        .foregroundStyle(Color(red: 0.55, green: 0.83, blue: 1.0))
        .padding(.horizontal, 8)
        .frame(height: 54)
        .background(Color(red: 0.035, green: 0.055, blue: 0.11))
        .overlay(alignment: .top) {
            Rectangle()
                .fill(.white.opacity(0.08))
                .frame(height: 1)
        }
    }
}

private struct FrostlyWebView: UIViewRepresentable {
    @ObservedObject var state: BrowserState

    func makeCoordinator() -> Coordinator {
        Coordinator(state: state)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.keyboardDismissMode = .interactive
        webView.isOpaque = false
        webView.backgroundColor = FrostlyConfig.background
        webView.scrollView.backgroundColor = FrostlyConfig.background

        state.webView = webView
        webView.load(URLRequest(url: FrostlyConfig.siteURL, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 35))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
        private let state: BrowserState

        init(state: BrowserState) {
            self.state = state
        }

        private func isAllowedInApp(_ url: URL) -> Bool {
            guard let host = url.host?.lowercased() else { return false }
            return FrostlyConfig.allowedHosts.contains(host)
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            if ["tel", "mailto", "sms"].contains(url.scheme?.lowercased() ?? "") {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            if url.scheme == "https", !isAllowedInApp(url), navigationAction.navigationType == .linkActivated {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            if url.scheme == "http" {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            guard let url = navigationAction.request.url else { return nil }
            if isAllowedInApp(url) {
                webView.load(URLRequest(url: url))
            } else {
                UIApplication.shared.open(url)
            }
            return nil
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            let response = navigationResponse.response as? HTTPURLResponse
            let disposition = response?.value(forHTTPHeaderField: "Content-Disposition")?.lowercased() ?? ""
            if disposition.contains("attachment") || !navigationResponse.canShowMIMEType {
                decisionHandler(.download)
            } else {
                decisionHandler(.allow)
            }
        }

        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
            download.delegate = self
        }

        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
            download.delegate = self
        }

        func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
            do {
                let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                let folder = documents.appendingPathComponent("Downloads", isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

                let safeName = suggestedFilename.replacingOccurrences(of: "/", with: "_")
                let filename = safeName.isEmpty ? "frostly-download" : safeName
                var destination = folder.appendingPathComponent(filename)
                if FileManager.default.fileExists(atPath: destination.path) {
                    destination = folder.appendingPathComponent("\(UUID().uuidString)-\(filename)")
                }
                completionHandler(destination)
            } catch {
                completionHandler(nil)
            }
        }

        func download(_ download: WKDownload, didFinishAt location: URL) {
            DispatchQueue.main.async {
                self.state.shareDownloadedFile(at: location)
            }
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            DispatchQueue.main.async {
                self.state.isLoading = true
                self.state.hasError = false
                self.state.syncNavigationState()
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            DispatchQueue.main.async {
                self.state.isLoading = false
                self.state.hasError = false
                self.state.syncNavigationState()
            }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            showLoadError()
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            showLoadError()
        }

        private func showLoadError() {
            DispatchQueue.main.async {
                self.state.isLoading = false
                self.state.hasError = true
                self.state.syncNavigationState()
            }
        }
    }
}

private struct FrostlyShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
