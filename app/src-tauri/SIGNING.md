# Desktop signing readiness

The checked-in base configuration keeps the already-smoke-tested ad-hoc macOS path (`hardenedRuntime=false`) and enables SHA-256/timestamp settings for Windows. Those settings **do not mean an installer is developer-signed or notarized**.

When no credentials are present, CI may keep using `APPLE_SIGNING_IDENTITY=-` for an ad-hoc macOS signature and may build the Windows installer without a certificate. Release text must continue to call those artifacts unsigned/unnotarized.

## Signed and notarized macOS build

Provide all of the following only in the protected release environment:

- `APPLE_CERTIFICATE`: base64-encoded Developer ID Application `.p12`
- `APPLE_CERTIFICATE_PASSWORD`: password for that `.p12`
- `APPLE_SIGNING_IDENTITY`: Developer ID Application identity (the Tauri CLI can infer it from the imported certificate, but making it explicit avoids selecting the wrong identity)
- Apple ID notarization credentials (`APPLE_ID`, app-specific `APPLE_PASSWORD`, and `APPLE_TEAM_ID`)

Use the release credentials as one complete set. A partial set should fail the release preflight instead of silently falling back to an artifact described as signed. The credentials are exposed only to the `main` release build. The credentialed CI path imports the certificate before PyInstaller, signs the one-file engine with the same Developer ID, and adds `tauri.macos-signing.conf.json`, enabling `bundle.macOS.hardenedRuntime=true`; Tauri then signs the app and its bundled sidecars before notarizing the DMG. The final-DMG smoke test remains mandatory because the embedded engine must also start successfully under the hardened runtime.

Verification for a credentialed build:

```sh
codesign --verify --deep --strict --verbose=2 "/path/to/中标狗.app"
codesign -dv --verbose=4 "/path/to/中标狗.app"
spctl --assess --type execute --verbose=4 "/path/to/中标狗.app"
xcrun stapler validate "/path/to/中标狗.app"
```

For the existing no-certificate CI path, keep the first `codesign --verify` check and report the identity as ad-hoc, not Developer ID/notarized.

## Signed Windows build

Import a code-signing PFX into the runner's `CurrentUser\\My` certificate store, compute its SHA-1 thumbprint, and generate a temporary copy of `tauri.windows-signing.conf.example.json` with the placeholder replaced. Do not commit the generated file or certificate.

Suggested protected secrets:

- `WINDOWS_CERTIFICATE`: base64-encoded PFX
- `WINDOWS_CERTIFICATE_PASSWORD`: PFX password

Pass the temporary overlay only when both secrets are present:

```text
npm run build -- --bundles nsis --config <temporary-signing-config.json>
```

If neither secret is present, build without the overlay and describe the installer as unsigned. If only one secret is present, fail preflight. Verify credentialed output with PowerShell `Get-AuthenticodeSignature`; require `Status` to be `Valid` and inspect `SignerCertificate.Thumbprint` before upload.
