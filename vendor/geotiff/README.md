# GeoTIFF.js

Official unmodified browser bundle from `geotiff@3.0.5`, MIT licensed (see `LICENSE`).

Source: https://github.com/geotiffjs/geotiff.js
Package: https://registry.npmjs.org/geotiff/-/geotiff-3.0.5.tgz

Verified package integrity (SHA-512):
`OWcL9S9+yDZ6iAlXMt32T1iwUApJM8UiD47xbm6ZP1h33d10fqkPs14EG/ttT5EnefpZSx3G15iDFC5FxUNUwA==`

Version 3 supports deferred tile-offset reads, important for the large published
BigTIFF rasters. The application uses a bounded custom HTTP range client with
`allowFullFile: false`. A server that ignores Range is rejected before its body
is downloaded. The source block cache is limited to 64 × 64 KiB per provider;
decoded tile caching is disabled by the library default.
Dataset readers are also retired after 24 operations to bound lazily loaded
tile-index metadata accumulated while exploring many locations.
