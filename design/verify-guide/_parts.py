INK_FILTER = '<svg width="0" height="0" style="position:absolute"><filter id="ink" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".09" numOctaves="2" seed="7" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="5" result="d"/><feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="1" seed="3" result="g"/><feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.9" result="m"/><feComposite in="d" in2="m" operator="in"/></filter></svg>'
def page(title, panels):
    return f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{title}</title><link rel="stylesheet" href="panels.css"></head><body>{INK_FILTER}' + ''.join(panels) + '</body></html>'
def panel(pid, guide, n, total, body):
    return f'<section class="panel" id="{pid}"><div class="strip"><div class="brand"><img src="avatar.png" alt="">SIXDOGS.GG</div><div class="ref">{guide} · {n}/{total}</div></div><div class="body">{body}</div></section>'
ICON = {
 'check': '<svg viewBox="0 0 26 26" fill="none" stroke="#e2e4da" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13.5l5 5L21 7.5"/></svg>',
 'info': '<svg viewBox="0 0 40 40" fill="none" stroke="#4d5530" stroke-width="3" stroke-linecap="round"><circle cx="20" cy="20" r="16"/><path d="M20 18v10"/><circle cx="20" cy="12.5" r="1.6" fill="#4d5530" stroke="none"/></svg>',
 'headset': '<svg viewBox="0 0 52 52" fill="none" stroke="#14160f" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 30v-4a17 17 0 0 1 34 0v4"/><rect x="7" y="29" width="9" height="13" rx="3"/><rect x="36" y="29" width="9" height="13" rx="3"/><path d="M41 42c0 4-4 6-9 6h-3"/></svg>',
 'rank': '<svg viewBox="0 0 52 52" fill="none" stroke="#14160f" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14l16 9 16-9"/><path d="M10 24l16 9 16-9"/><path d="M10 34l16 9 16-9"/></svg>',
 'rate': '<svg viewBox="0 0 52 52" fill="none" stroke="#14160f" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="36" height="36" rx="3"/><path d="M15 20l3 3 6-6M15 33l3 3 6-6M29 20h9M29 33h9"/></svg>',
 'speak': '<svg viewBox="0 0 52 52" fill="none" stroke="#14160f" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 20v12h8l12 9V11l-12 9z"/><path d="M35 19a9 9 0 0 1 0 14M40 14a16 16 0 0 1 0 24"/></svg>',
 'move': '<svg viewBox="0 0 52 52" fill="none" stroke="#14160f" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 38l10-10 8 8 14-16"/><path d="M34 20h8v8"/></svg>',
 'chat': '<svg viewBox="0 0 52 52" fill="none" stroke="#14160f" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 10h40v24H22l-10 8v-8H6z"/><path d="M14 19h24M14 26h14"/></svg>',
 'map': '<svg viewBox="0 0 52 52" fill="none" stroke="#14160f" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12l12-5 16 6 12-5v32l-12 5-16-6-12 5z"/><path d="M18 7v32M34 13v32"/></svg>',
}
