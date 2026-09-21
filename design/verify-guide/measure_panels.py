# Does everything fit? Run this before rendering a panel.
#
# A panel is a fixed 1200x675 box with overflow:hidden, so content that doesn't
# fit is not flagged, wrapped or scrolled. It is silently cut off the bottom of
# the picture, and the only way to notice is to look at the finished image. A
# first draft of the start-a-match panel lost two of its four steps that way.
#
#   python3 measure_panels.py start-a-match-panels
#
# Reports, per panel: how much the content overflows (0 is what you want), and
# the gap between the last thing in each column and the footer rule. A gap near
# zero is the "crammed" look even when nothing is technically cut off.
import sys, os, glob
from playwright.sync_api import sync_playwright

here = os.path.dirname(os.path.abspath(__file__))


def chrome():
    if os.environ.get('PW_CHROME'):
        return os.environ['PW_CHROME']
    found = sorted(glob.glob('/opt/pw-browsers/chromium-*/chrome-linux/chrome'))
    return found[-1] if found else None


with sync_playwright() as p:
    exe = chrome()
    b = p.chromium.launch(args=["--allow-file-access-from-files"],
                          **({'executable_path': exe} if exe else {}))
    bad = 0
    for name in sys.argv[1:]:
        pg = b.new_page(viewport={"width": 1240, "height": 900})
        pg.goto(f"file://{here}/{name}.html")
        pg.wait_for_timeout(600)
        for el in pg.locator(".panel").all():
            pid = el.get_attribute("id")
            r = pg.evaluate("""(id) => {
              const panel = document.getElementById(id);
              const body = panel.querySelector('.body');
              const foot = panel.querySelector('.foot');
              const cols = panel.querySelectorAll('.cols > div, .grid4 > div');
              const bottom = foot ? foot.getBoundingClientRect().top
                                  : body.getBoundingClientRect().bottom;
              return {
                overflow: body.scrollHeight - body.clientHeight,
                gaps: [...cols].map((c) => Math.round(
                  bottom - c.lastElementChild.getBoundingClientRect().bottom)),
              };
            }""", pid)
            tight = r['overflow'] > 0 or any(g < 16 for g in r['gaps'])
            if tight:
                bad += 1
            print(f"{'TIGHT' if tight else 'ok   '} {pid}  overflow={r['overflow']}  gaps={r['gaps']}")
        pg.close()
    b.close()
    sys.exit(1 if bad else 0)
