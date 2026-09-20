# Splits a tall guide into two pictures at the Nth section rule, so each reads well on a phone.
import sys, os
from PIL import Image
from playwright.sync_api import sync_playwright
here = os.path.dirname(os.path.abspath(__file__))
name, n = sys.argv[1], int(sys.argv[2])
with sync_playwright() as p:
    b = p.chromium.launch(args=["--allow-file-access-from-files"])
    pg = b.new_page(viewport={"width": 1080, "height": 1200}, device_scale_factor=2)
    pg.goto(f"file://{here}/{name}.html"); pg.wait_for_timeout(600)
    y = pg.evaluate(f"document.querySelectorAll('.hr')[{n}].getBoundingClientRect().top + window.scrollY")
    b.close()
im = Image.open(f"{here}/{name}.png")
cut = int(y * 2)
im.crop((0, 0, im.width, cut)).save(f"{here}/{name}-1.png")
bottom = im.crop((0, cut, im.width, im.height))
pad = Image.new(im.mode, (im.width, bottom.height + 80), im.getpixel((10, cut + 40)))
pad.paste(bottom, (0, 60))
pad.save(f"{here}/{name}-2.png")
print(cut, im.height - cut)
