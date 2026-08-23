from conftest import ROOT


def test_proprietary_license_names_the_confirmed_individual_rights_holder():
    license_text = (ROOT / "LICENSE").read_text(encoding="utf-8")
    notice = (ROOT / "NOTICE").read_text(encoding="utf-8")
    eula = (ROOT / "EULA.md").read_text(encoding="utf-8")

    assert "版权所有 © 2026 张家涛。保留所有权利。" in license_text
    assert "Copyright © 2026 Zhang Jiatao. All Rights Reserved." in license_text
    assert "本软件不是开源软件" in license_text
    assert "版权所有 © 2026 张家涛。保留所有权利。" in notice
    assert "许可人：张家涛" in eula
    assert "具体投标文件、分析报告和 Word 结果" in eula
    assert "不转让本软件底层引擎" in eula


def test_user_visible_copyright_statement_is_present_in_all_frontend_copies():
    for relative in (
        "app/src/index.html",
        "site/demo.html",
        "site/app/index.html",
    ):
        assert "© 2026 张家涛" in (ROOT / relative).read_text(encoding="utf-8")

    homepage = (ROOT / "site/index.html").read_text(encoding="utf-8")
    assert "中标狗 · 作者 FDE 家涛" in homepage
    assert "https://avatars.githubusercontent.com/u/106303992?v=4" in homepage
    assert 'aria-label="Orcastao 的 GitHub 主页"' in homepage
    assert "<span>FDE 家涛</span></a>" in homepage
    assert homepage.count('aria-label="Orcastao 的 GitHub 主页"') == 1
    assert "GitHub · shandianT" not in homepage
    assert "本地运行 · 保留所有权利" not in homepage
    assert "许可协议</a>" not in homepage
