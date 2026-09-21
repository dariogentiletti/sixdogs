// The facts in {{ }} come from community.json in the main SIXDOGS folder
// (founder letter, costs, donation platform and link). Change them there, then restart the bot.
// The Donate button appears once donate.url has a link.
// Cost values are bare ("$115", "free"); "per month" is said once, on the total.

# Support the community
color: gold
I am *{{founder.name}}* and {{founder.opening}}

{{founder.letter}}

*{{founder.name}}*

// Values are bare ("$115", "free") so "/ month" is said once, on the total.
{{#each costs.items}}### {{item}}
{{monthly}}

{{/each}}### Total
{{costs.total}} per month

## Where the money goes
{{costs.leftover}}

## How to donate
{{#if donate.url}}Press **{{donate.button}}** below. {{else}}The {{donate.platform}} link is coming soon. {{/if}}{{donate.how}}
footer: Questions about the money? Ask an admin.
{{#if donate.url}}button: {{donate.button}} | {{donate.url}}{{/if}}
