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
