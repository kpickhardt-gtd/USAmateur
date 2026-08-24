// Hole images and marshal stations.
//
// THE TWO STAGES ARE SEPARATE ON PURPOSE.
//
// Stage 1 produces `image`: a picture of the hole plus where the tee, the
// green, and any dogleg SHOT POINTS sit on it (fractions of its width/height).
// Today those images are captured from satellite; later they can be official
// course artwork. `source` is only the satellite provenance for re-capturing.
//
// Stage 2 produces `marshals`, in CENTRE-LINE coordinates:
//     t             0 = tee, 1 = green, measured ALONG the path
//                   tee -> S1 -> S2 -> green (so a dogleg follows the fairway)
//     offsetYards   across the fairway; + = right, looking down the hole
//     radiusYards   size of the highlight circle
// These reference neither pixels nor lat/lng. Swap the image, re-mark its
// tee/green/shot points, and every station lands correctly with no rework.
//
// NOTHING is filled in yet. Use admin.html:
//   Stage 1  place tee, green, and shot points for doglegs; capture or upload
//   Stage 2  place the marshal stations on the image
// Then export this file and commit it, along with images/holes/.
const HOLES_DATA = {
  "east": {
    "name": "Oak Hill East",
    "holes": [
      {
        "number": 1,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 2,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 3,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 4,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 5,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 6,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 7,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 8,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 9,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 10,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 11,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 12,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 13,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 14,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 15,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 16,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 17,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 18,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      }
    ]
  },
  "west": {
    "name": "Oak Hill West",
    "holes": [
      {
        "number": 1,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 2,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 3,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 4,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 5,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 6,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 7,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 8,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 9,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 10,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 11,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 12,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 13,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 14,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 15,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 16,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 17,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      },
      {
        "number": 18,
        "par": null,
        "lengthYards": null,
        "image": null,
        "imageReady": false,
        "source": {
          "kind": "satellite",
          "tee": null,
          "green": null,
          "bearingNudge": 0,
          "zoomNudge": 0,
          "shots": []
        },
        "marshals": [],
        "spotsDone": false
      }
    ]
  }
};
