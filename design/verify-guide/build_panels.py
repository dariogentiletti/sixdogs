from _parts import page, panel, ICON
import json, os, html
# Facts (hardcore settings, ...) come from community.json in the main SIXDOGS folder.
FACTS = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'community.json'), encoding='utf-8'))
esc = html.escape
G='GET VERIFIED'; T=5
v = [
panel('v1', G, 1, T, '''
  <h1><span>Get</span><span>verified.</span></h1>
  <p class="lede">Link your Discord to your WARDOGS account. <b>One minute, and you only do it once.</b></p>
  <p style="margin-top:auto;max-width:660px;font-size:38px"><span class="mark">Players who aren't verified get kicked</span> from the game server. Do it as soon as you join.</p>
  <div class="stamp" style="right:60px;bottom:70px">Required<small>TO PLAY ON SIXDOGS</small></div>'''),
panel('v2', G, 2, T, '''<div class="cols">
  <div><div class="num">1</div><h3>Join the server</h3>
    <p><span class="w">In game.</span> Start WARDOGS and join SIXDOGS. <b>Stay in the game</b> until you're done.</p>
    <p class="tip" style="font-size:28px">The bot can only find you while you're playing.</p></div>
  <div><div class="num">2</div><h3>Type /verify</h3>
    <p><span class="w">In Discord.</span> Add your name <b>as it shows on the scoreboard.</b></p>
    <div class="typed">/verify <span class="opt">name</span><span class="val">Rook</span><span class="caret"></span></div>
    <div class="tip">'''+ICON['info']+'''<span><b>Same name as someone?</b> Paste your Steam profile link instead.</span></div></div>
</div>'''),
panel('v3', G, 3, T, '''<div class="cols">
  <div><div class="num">3</div><h3>Read your code</h3>
    <p><span class="w">In game.</span> A private message with a short code. <b>It works for 10 minutes.</b></p>
    <div class="slip"><div class="t">PRIVATE MESSAGE</div><div class="m">SIXDOGS verification code: <span class="k">417</span></div></div></div>
  <div><div class="num">4</div><h3>Type /confirm</h3>
    <p><span class="w">In Discord.</span> Enter the code from the message.</p>
    <div class="typed">/confirm <span class="opt">code</span><span class="val">417</span><span class="caret"></span></div></div>
</div>'''),
panel('v4', G, 4, T, '''<div class="cols">
  <div><div class="num">5</div><h3>You're verified</h3>
    <p>The bot confirms it and you get the <b>Verified</b> role. Your team colour follows you whenever you play.</p></div>
  <div style="display:flex;flex-direction:column;justify-content:center">
    <div class="reply" style="font-size:36px"><span class="ok">'''+ICON['check']+'''</span><span>Linked to <b>Rook</b>. You're <b>Verified</b>.</span></div>
    <div class="chips" style="margin-top:24px"><span class="chip" style="font-size:32px"><i style="background:var(--gold)"></i>Verified</span><span class="chip" style="font-size:32px"><i style="background:var(--blue)"></i>Blue</span></div></div>
</div>'''),
panel('v5', G, 5, T, '''<h2>What you get</h2>
<div class="cols three" style="margin-top:26px">
  <div><div class="ic">'''+ICON['headset']+'''</div><h3 style="font-size:44px">Hear your commander</h3><p style="font-size:30px;margin-top:10px">A place in your team's <b>listen</b> channel. Only the commander talks there.</p></div>
  <div><div class="ic">'''+ICON['rank']+'''</div><h3 style="font-size:44px">A shot at command</h3><p style="font-size:30px;margin-top:10px">Pick <b>Commander</b> in #roles and the bot can ask you to lead.</p></div>
  <div><div class="ic">'''+ICON['rate']+'''</div><h3 style="font-size:44px">Rate your commander</h3><p style="font-size:30px;margin-top:10px">After each match you get a DM to rate how they led.</p></div>
</div>
<div class="foot"><span>Stuck? Ask an <span class="mention">@Admin</span></span></div>'''),
]
open('verify-panels.html','w').write(page('SIXDOGS get verified', v))

H='HOW WE PLAY'; T=5
mapsvg = '''<svg viewBox="0 0 860 330" fill="none"><g stroke="#9aa08a" stroke-width="2"><path d="M0 250c120-40 180 20 300-10s190-90 330-60 180 40 230 20"/><path d="M0 200c140-50 200 10 320-20s180-80 320-50 160 30 220 10"/><path d="M0 110c90 30 200-40 310-10s170 60 300 30 190-50 250-40"/><path d="M0 60c110 20 220-30 330-5s150 40 280 20 180-40 250-30"/></g><g stroke="#c9d0b8" stroke-width="1.5"><path d="M0 110h860M0 220h860M215 0v330M430 0v330M645 0v330"/></g><circle cx="560" cy="150" r="62" fill="rgba(201,162,39,.22)" stroke="#8a6f1a" stroke-width="4" stroke-dasharray="10 8"/><path d="M140 270C230 230 330 200 470 165" stroke="#c9a227" stroke-width="12" stroke-linecap="round"/><path d="M448 140l40 20-30 32" stroke="#c9a227" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><g stroke="#a3261f" stroke-width="8" stroke-linecap="round"><path d="M700 60l30 30M730 60l-30 30"/><path d="M745 215l26 26M771 215l-26 26"/></g><rect x="120" y="258" width="34" height="34" fill="#3a7bd5" stroke="#14160f" stroke-width="3"/></svg>'''
h = [
panel('h1', H, 1, T, '''
  <h1><span>Play as</span><span>a team.</span></h1>
  <p class="lede" style="max-width:980px;font-size:40px">At SIXDOGS we want a game mode that rewards teamwork. When the whole team goes for the same objective, <b>the game is more fun for everyone.</b></p>
  <p style="margin-top:auto;max-width:980px;font-size:34px">Every team has a commander. The team calls out what it sees, the commander turns it into one plan, and everyone pushes together.</p>'''),
panel('hc', H, 2, T, '''<h2>Hardcore settings</h2>
<div class="grid4" style="grid-template-columns:1fr 1fr;row-gap:26px">'''
  + ''.join(f'''
  <div style="grid-template-columns:1fr"><div><h3>{esc(x['name'])} <span class="mark">{esc(x['value'])}</span></h3><p style="font-size:27px">{esc(x['text'])}</p></div></div>''' for x in FACTS['hardcore']['settings'])
  + '''
</div>'''),
panel('h2', H, 3, T, '''<h2>How a commander is picked</h2>
<div class="grid4">
  <div><div class="n">1</div><div><h3>Put your hand up</h3><p>Pick <b>Commander</b> in #roles to join the pool.</p></div></div>
  <div><div class="n">2</div><div><h3>The bot picks</h3><p>From the pool, <b>best rated first</b>. Nobody in the pool? Someone at random.</p></div></div>
  <div><div class="n">3</div><div><h3>60 seconds</h3><p>Accept the DM and you're commander. No answer? Next person.</p></div></div>
  <div><div class="n">4</div><div><h3>It stays yours</h3><p>Until you <b>/standdown</b> or leave the server for over 5 min.</p></div></div>
</div>'''),
panel('h3', H, 4, T, '''<h2>If you're the commander</h2>
<div class="cols" style="margin-top:24px">
  <div><h3 style="font-size:46px">Build the plan</h3><p style="margin-top:10px;font-size:31px">Take what your team is calling out and turn it into one plan: where to push, when to take the zone, when to hold. You're the only voice, so keep it short.</p>
    <div class="quote">"Everyone on the zone. Now."</div>
    <p style="margin-top:22px;font-size:28px"><b>Keep your head.</b> Your team rates you after every match.</p></div>
  <div><h3 style="font-size:46px">Draw the plan</h3><p style="margin-top:10px;font-size:31px">Optional: start <b>Wardogs Tech</b> from the Activities button in your team's voice channel.</p>
    <div class="map"><div class="t"><span>LIVE MAP</span><span>WARDOGS TECH</span></div>'''+mapsvg+'''</div></div>
</div>'''),
panel('h4', H, 5, T, '''<h2>Everyone else</h2>
<div class="cols" style="margin-top:24px">
  <div><h3 style="font-size:46px">Listen in</h3><p style="margin-top:10px;font-size:31px">Join your team's <b>(listen)</b> voice channel.</p>
    <h3 style="font-size:46px;margin-top:30px">Move together</h3><p style="margin-top:10px;font-size:31px">Stick with your squad. When the call comes, go.</p></div>
  <div><h3 style="font-size:46px">Call it out in TEAM chat</h3><p style="margin-top:10px;font-size:31px">Where, what, which way. For an exact spot, <b>right-click the map</b> to mark the coordinates and post them.</p>
    <div class="slip"><div class="t">TEAM CHAT</div><div class="m"><span class="k">x98.43, y110.38</span> 2 tanks north</div><div class="m"><span class="k">North tower</span> 3 on roof</div></div></div>
</div>'''),
]
open('how-to-play-panels.html','w').write(page('SIXDOGS how we play', h))

# ---------------------------------------------------------------------------
# #start-a-match. One panel, because the live board sits right underneath it.
#
# Deliberately NO numbers in here. The target is whatever the game server's own
# match-start setting says and it can change in one command, but a picture can
# only change by being re-rendered and re-uploaded. The board below always shows
# the real count, so the picture explains the idea and leaves the arithmetic to
# the thing that can keep up.
S = 'START A MATCH'
# The body is only about 535px tall once the strip and padding are taken off, so
# the hero type is dialled down and every step is a line or two. A first draft
# with a full-size h1 and a three-line lede pushed steps 3 and 4 off the bottom.
s = [
panel('s1', S, 1, 1, '''
  <h1 style="font-size:64px"><span>Server quiet?</span><span>Don\'t sit in it.</span></h1>
  <p class="lede" style="font-size:30px;margin-top:10px;max-width:1010px">Nobody wants to be the first one on an empty map. <b>So don\'t wait in the server. Wait in Discord</b>, and we will all go in together.</p>
  <div class="grid4" style="margin-top:12px;row-gap:12px">
    <div><div class="n">1</div><div><h3 style="font-size:40px">Say you want to play</h3><p style="font-size:27px">One button in <b>#start-a-match</b>.</p></div></div>
    <div><div class="n">2</div><div><h3 style="font-size:40px">Go and do something else</h3><p style="font-size:27px">Your name stays on the list. <b>You are not holding a seat.</b></p></div></div>
    <div><div class="n">3</div><div><h3 style="font-size:40px">We call you back</h3><p style="font-size:27px">Enough people want a game and <span class="mention">@Match Alerts</span> gets pinged.</p></div></div>
    <div><div class="n">4</div><div><h3 style="font-size:40px">You get a real match</h3><p style="font-size:27px">Full teams and commanders, not four of you on a huge map.</p></div></div>
  </div>
  <div class="foot" style="padding-top:12px"><span>Want the ping? Take <span class="mention">@Match Alerts</span> with 📣 in #roles</span></div>'''),
]
open('start-a-match-panels.html','w').write(page('SIXDOGS start a match', s))
