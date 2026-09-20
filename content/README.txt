These are the posts the bot keeps in your Discord channels.

The file name is the channel: rules.md goes in #rules, get-verified.md in #get-verified,
how-to-play.md in #how-to-play, announcements.md in #announcements. #server-info is different:
the bot keeps a live board there by itself, so server-info.md isn't used. To add a post for another channel, make a new file
named after that channel.

To change a post, edit the file here and restart the bot. It updates the existing message,
so nobody gets a new notification.

HOW TO FORMAT

  # Card title         starts a card (the box with the coloured bar on the left)
  color: red           right under the title: gold, red, green, blue, dark, or a #hex code
  Some text            the card's main text
  ## Section           a section with a bold heading, full width
  ### Box              a small box. Two or three in a row sit side by side (good for IP, port)
  footer: text         small grey text at the bottom of the card
  image: guide.jpg     a picture from this folder, shown in the card
  button: Text | https://...   a link button under the post (up to 5)
  panel: guide.jpg     a picture posted as its own message, full size. One line per picture,
                       in order. Lines above the first card are posted before the card.
  ---                  starts the next card
  // note              a note for yourself; the bot ignores the line

  **bold**   *italic*   {#roles} becomes a clickable link to #roles (not in footers)

PICTURES
The guides in #get-verified and #how-to-play are wide pictures (verify-v1..v5.jpg and
play-h1..h5.jpg), one per message so Discord shows them full size. They're made from
design/verify-guide/build_panels.py. Replace a .jpg here and restart to update it.

JOIN DETAILS
The live board in #server-info shows the Server ID from the game server. If players need a
different ID or link, set GAME_SERVER_ID or JOIN_URL in .env.
