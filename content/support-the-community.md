// The facts in {{ }} come from community.json in the main SIXDOGS folder
// (founder letter, costs, donation platform and link). Change them there, then restart the bot.
// The Donate button appears once donate.url has a link.

# Support the community
color: gold
{{founder.letter}}

*{{founder.name}}*

{{#each costs.items}}### {{item}}
{{monthly}} / month

{{/each}}### Total
{{costs.total}} / month

## Where the money goes
{{costs.leftover}}

## How to donate
{{#if donate.url}}Press **{{donate.button}}** below. {{else}}The {{donate.platform}} link is coming soon. {{/if}}{{donate.how}}
footer: Questions about the money? Ask an admin.
{{#if donate.url}}button: {{donate.button}} | {{donate.url}}{{/if}}
