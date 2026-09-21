# Renders every .panel in the given pages to <id>.png (2x) for the Discord guides.
import sys, os, glob
from playwright.sync_api import sync_playwright
here = os.path.dirname(os.path.abspath(__file__))


def chrome():
    """The Chromium already on this machine.

    Playwright pins an exact browser revision and refuses to launch anything
    else, which is a problem on a box where Chromium is pre-installed at some
    other revision: it tells you to run `playwright install`, which downloads a
    second copy of a browser that is already there. Point it at the one on disk
    instead. PW_CHROME overrides, otherwise take the newest that is there.
    """
    if os.environ.get('PW_CHROME'):
        return os.environ['PW_CHROME']
    found = sorted(glob.glob('/opt/pw-browsers/chromium-*/chrome-linux/chrome'))
    return found[-1] if found else None


with sync_playwright() as p:
    exe = chrome()
    b = p.chromium.launch(args=["--allow-file-access-from-files"],
                          **({'executable_path': exe} if exe else {}))
    for name in sys.argv[1:]:
        pg = b.new_page(viewport={"width": 1240, "height": 800}, device_scale_factor=2)
        pg.goto(f"file://{here}/{name}.html"); pg.wait_for_timeout(700)
        for el in pg.locator(".panel").all():
            pid = el.get_attribute("id")
            el.screenshot(path=f"{here}/panels/{pid}.png")
            print(pid)
    b.close()
