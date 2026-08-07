import json
import re

from conftest import ROOT


def test_release_version_is_consistent(engine):
    version = engine.ENGINE_VERSION
    assert version == "0.18.2"
    assert json.loads((ROOT / "app" / "package.json").read_text())["version"] == version
    assert json.loads((ROOT / "app" / "package-lock.json").read_text())["version"] == version
    assert json.loads((ROOT / "app" / "src-tauri" / "tauri.conf.json").read_text())["version"] == version

    cargo = (ROOT / "app" / "src-tauri" / "Cargo.toml").read_text()
    assert re.search(r'^version\s*=\s*"%s"$' % re.escape(version), cargo, re.M)
    workflow = (ROOT / ".github" / "workflows" / "build.yml").read_text()
    assert "tag_name: desktop-v" + version in workflow
    assert 'CFBundleShortVersionString raw "$app_path/Contents/Info.plist\")" = "' + version in workflow

    readme = (ROOT / "README.md").read_text()
    site = (ROOT / "site" / "index.html").read_text()
    for text in (readme, site):
        assert "desktop-v%s/bid-dog_%s_aarch64.dmg" % (version, version) in text
        assert "desktop-v%s/bid-dog_%s_x64-setup.exe" % (version, version) in text


def test_windows_installer_has_a_real_packaged_sidecar_smoke_gate(engine):
    workflow = (ROOT / ".github" / "workflows" / "build.yml").read_text()

    assert "verify Windows installer payload and bundled executables" in workflow
    assert "if: runner.os == 'Windows'" in workflow
    assert '"/S"' in workflow
    assert '"/D=' in workflow
    assert "opencode-cli.exe" in workflow
    assert "bid-engine.exe" in workflow
    assert "/v1/health" in workflow
    assert 'version -ne "0.18.2"' in workflow
