// Hole coordinates and marshal spot data.
// NOTE: these coordinates are still PLACEHOLDERS arranged in a circle
// around the clubhouse -- they do not reflect the real Oak Hill routing yet.
// Use admin.html to reposition each hole's center/zoom and marshal spots
// by looking at the real satellite imagery, then download the updated file
// from there and replace this one.
const HOLES_DATA = {
  "east": {
    "name": "Oak Hill East",
    "holes": [
      {
        "number": 1,
        "par": null,
        "center": [
          43.1136,
          -77.52566
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.1136,
            "lng": -77.52566,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 2,
        "par": null,
        "center": [
          43.1149,
          -77.525958
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.1149,
            "lng": -77.525958,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 3,
        "par": null,
        "center": [
          43.116043,
          -77.526816
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.116043,
            "lng": -77.526816,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 4,
        "par": null,
        "center": [
          43.116891,
          -77.52813
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.116891,
            "lng": -77.52813,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 5,
        "par": null,
        "center": [
          43.117342,
          -77.529742
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.117342,
            "lng": -77.529742,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 6,
        "par": null,
        "center": [
          43.117342,
          -77.531458
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.117342,
            "lng": -77.531458,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 7,
        "par": null,
        "center": [
          43.116891,
          -77.53307
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.116891,
            "lng": -77.53307,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 8,
        "par": null,
        "center": [
          43.116043,
          -77.534384
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.116043,
            "lng": -77.534384,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 9,
        "par": null,
        "center": [
          43.1149,
          -77.535242
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.1149,
            "lng": -77.535242,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 10,
        "par": null,
        "center": [
          43.1136,
          -77.53554
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.1136,
            "lng": -77.53554,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 11,
        "par": null,
        "center": [
          43.1123,
          -77.535242
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.1123,
            "lng": -77.535242,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 12,
        "par": null,
        "center": [
          43.111157,
          -77.534384
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.111157,
            "lng": -77.534384,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 13,
        "par": null,
        "center": [
          43.110309,
          -77.53307
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.110309,
            "lng": -77.53307,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 14,
        "par": null,
        "center": [
          43.109858,
          -77.531458
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.109858,
            "lng": -77.531458,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 15,
        "par": null,
        "center": [
          43.109858,
          -77.529742
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.109858,
            "lng": -77.529742,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 16,
        "par": null,
        "center": [
          43.110309,
          -77.52813
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.110309,
            "lng": -77.52813,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 17,
        "par": null,
        "center": [
          43.111157,
          -77.526816
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.111157,
            "lng": -77.526816,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 18,
        "par": null,
        "center": [
          43.1123,
          -77.525958
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.1123,
            "lng": -77.525958,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      }
    ]
  },
  "west": {
    "name": "Oak Hill West",
    "holes": [
      {
        "number": 1,
        "par": null,
        "center": [
          43.1106,
          -77.52294
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.1106,
            "lng": -77.52294,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 2,
        "par": null,
        "center": [
          43.111694,
          -77.523191
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.111694,
            "lng": -77.523191,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 3,
        "par": null,
        "center": [
          43.112657,
          -77.523913
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.112657,
            "lng": -77.523913,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 4,
        "par": null,
        "center": [
          43.113371,
          -77.52502
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.113371,
            "lng": -77.52502,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 5,
        "par": null,
        "center": [
          43.113751,
          -77.526378
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.113751,
            "lng": -77.526378,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 6,
        "par": null,
        "center": [
          43.113751,
          -77.527822
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.113751,
            "lng": -77.527822,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 7,
        "par": null,
        "center": [
          43.113371,
          -77.52918
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.113371,
            "lng": -77.52918,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 8,
        "par": null,
        "center": [
          43.112657,
          -77.530287
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.112657,
            "lng": -77.530287,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 9,
        "par": null,
        "center": [
          43.111694,
          -77.531009
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.111694,
            "lng": -77.531009,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 10,
        "par": null,
        "center": [
          43.1106,
          -77.53126
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.1106,
            "lng": -77.53126,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 11,
        "par": null,
        "center": [
          43.109506,
          -77.531009
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.109506,
            "lng": -77.531009,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 12,
        "par": null,
        "center": [
          43.108543,
          -77.530287
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.108543,
            "lng": -77.530287,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 13,
        "par": null,
        "center": [
          43.107829,
          -77.52918
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.107829,
            "lng": -77.52918,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 14,
        "par": null,
        "center": [
          43.107449,
          -77.527822
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.107449,
            "lng": -77.527822,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 15,
        "par": null,
        "center": [
          43.107449,
          -77.526378
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.107449,
            "lng": -77.526378,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 16,
        "par": null,
        "center": [
          43.107829,
          -77.52502
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.107829,
            "lng": -77.52502,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 17,
        "par": null,
        "center": [
          43.108543,
          -77.523913
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.108543,
            "lng": -77.523913,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      },
      {
        "number": 18,
        "par": null,
        "center": [
          43.109506,
          -77.523191
        ],
        "zoom": 18,
        "marshals": [
          {
            "lat": 43.109506,
            "lng": -77.523191,
            "label": "Marshal spot 1 - PLACEHOLDER",
            "radius": 12
          }
        ]
      }
    ]
  }
};
