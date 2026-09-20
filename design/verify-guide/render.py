import sys, os
from playwright.sync_api import sync_playwright
here = os.path.dirname(os.path.abspath(__file__))
names = sys.argv[1:] or ['briefing', 'hud']
with sync_playwright() as p:
    b = p.chromium.launch(args=["--allow-file-access-from-files"])
    for n in names:
        pg = b.new_page(viewport={"width": 1080, "height": 1200}, device_scale_factor=2)
        pg.goto(f"file://{here}/{n}.html"); pg.wait_for_timeout(600)
        el = pg.locator("body > div").first
        el.screenshot(path=f"{here}/{n}.png")
        print(n, pg.evaluate("document.body.firstElementChild.offsetHeight"))
    b.close()
