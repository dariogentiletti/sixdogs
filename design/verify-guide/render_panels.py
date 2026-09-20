# Renders every .panel in the given pages to <id>.png (2x) for the Discord guides.
import sys, os
from playwright.sync_api import sync_playwright
here = os.path.dirname(os.path.abspath(__file__))
with sync_playwright() as p:
    b = p.chromium.launch(args=["--allow-file-access-from-files"])
    for name in sys.argv[1:]:
        pg = b.new_page(viewport={"width": 1240, "height": 800}, device_scale_factor=2)
        pg.goto(f"file://{here}/{name}.html"); pg.wait_for_timeout(700)
        for el in pg.locator(".panel").all():
            pid = el.get_attribute("id")
            el.screenshot(path=f"{here}/panels/{pid}.png")
            print(pid)
    b.close()
