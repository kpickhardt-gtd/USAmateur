# Hole images

One image per hole, named `<course>-<NN>.jpg` — e.g. `east-01.jpg`, `west-18.jpg`.

These are produced by **stage 1** of `admin.html`, which either captures them
from satellite imagery or takes an image you upload. Save the downloaded files
here and commit them.

Each image is landscape with the hole running **left to right** (tee at the
left, green at the right). Phones rotate it a quarter turn so the hole stands
up with the tee at the bottom.

The site does not read these filenames directly — each hole record in
`js/holes-data.js` stores its own `image.src`, along with where the tee and
green sit on that image. To swap an image, drop the new file in, then re-mark
its tee and green in stage 2; every marshal station follows automatically
because stations are stored relative to the hole axis, not to the picture.
