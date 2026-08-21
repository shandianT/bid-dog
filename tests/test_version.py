import json
import re

from conftest import ROOT


def test_release_version_is_consistent(engine):
    version = engine.ENGINE_VERSION
    assert version == "0.19.5"
    assert json.loads((ROOT / "app" / "package.json").read_text())["version"] == version
    assert json.loads((ROOT / "app" / "package-lock.json").read_text())["version"] == version
    assert json.loads((ROOT / "app" / "src-tauri" / "tauri.conf.json").read_text())["version"] == version

    cargo = (ROOT / "app" / "src-tauri" / "Cargo.toml").read_text()
    assert re.search(r'^version\s*=\s*"%s"$' % re.escape(version), cargo, re.M)
    workflow = (ROOT / ".github" / "workflows" / "build.yml").read_text()
    assert "tag_name: desktop-v" + version in workflow
    assert 'CFBundleShortVersionString raw "$app_path/Contents/Info.plist\")" = "' + version in workflow

    readme = (ROOT / "README.md").read_text()
    assert "desktop-v%s/bid-dog_%s_aarch64.dmg" % (version, version) in readme
    assert "desktop-v%s/bid-dog_%s_x64-setup.exe" % (version, version) in readme

    # The homepage fallback may deliberately stay on the previous verified
    # release during the installer build. Its JS promotes atomically only after
    # both installers and SHA256SUMS exist, then a site-only commit advances the
    # static fallback without retriggering the installer workflow.
    site = (ROOT / "site" / "index.html").read_text()
    assert "api.github.com/repos/shandianT/bid-dog/releases" in site
    assert "SHA256SUMS" in site
    assert "_aarch64.dmg" in site and "_x64-setup.exe" in site


def test_windows_installer_has_a_real_packaged_sidecar_smoke_gate(engine):
    workflow = (ROOT / ".github" / "workflows" / "build.yml").read_text()

    assert "verify Windows installer payload and bundled executables" in workflow
    assert "if: runner.os == 'Windows'" in workflow
    assert '"/S"' in workflow
    assert '"/D=' in workflow
    assert "opencode-cli.exe" in workflow
    assert "bid-engine.exe" in workflow
    assert "/v1/health" in workflow
    assert 'version -ne "%s"' % engine.ENGINE_VERSION in workflow


def test_release_assets_are_explicit_and_published_releases_are_immutable(engine):
    version = engine.ENGINE_VERSION
    workflow = (ROOT / ".github" / "workflows" / "build.yml").read_text()

    assert "target_commitish: ${{ github.sha }}" in workflow
    assert "cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}" in workflow
    assert "draft: true" in workflow
    assert "overwrite_files: true" in workflow
    assert "fail_on_unmatched_files: true" in workflow
    assert "releases are immutable" in workflow
    assert "same commit" in workflow
    assert 'releases?per_page=100' in workflow
    assert "Draft release desktop-v0.19.5 belongs to another commit" in workflow
    assert "verify staged release assets" in workflow
    # A newly-created draft tag is briefly not discoverable through the
    # /releases/tags/{tag} endpoint. Verify and publish by the action's stable
    # numeric release id so a successful upload cannot be stranded as a draft.
    assert "id: stage_release" in workflow
    assert 'release_id="${{ steps.stage_release.outputs.id }}"' in workflow
    assert 'releases/$release_id' in workflow
    assert "-F draft=false" in workflow
    assert "-f make_latest=true" in workflow
    assert 'state == "uploaded"' in workflow
    assert "size > 0" in workflow
    assert "files: |" in workflow
    assert "out/bid-dog_%s_aarch64.dmg" % version in workflow
    assert "out/bid-dog_%s_x64-setup.exe" % version in workflow
    assert "out/SHA256SUMS" in workflow


def test_commercial_macos_signing_imports_identity_before_building_the_engine(engine):
    workflow = (ROOT / ".github" / "workflows" / "build.yml").read_text()

    assert workflow.index("import Apple Developer certificate") < workflow.index("build engine sidecar")
    assert 'codesign_args=(--codesign-identity "$APPLE_SIGNING_IDENTITY")' in workflow
    assert '"${codesign_args[@]}"' in workflow
    assert "github.ref == 'refs/heads/main' && secrets.APPLE_CERTIFICATE" in workflow
    build_step = workflow[workflow.index("- name: build installers"):workflow.index("- name: verify macOS DMG")]
    assert "MAC_APPLE_ID_SECRET:" in build_step
    assert "unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID" in build_step
    assert "\n          APPLE_ID:" not in build_step
