# Published global SDG 15.3.1 mapped estimates

The browser reads the actual published Cloud Optimized GeoTIFFs (COGs) through small HTTP byte ranges. The full global files are not bundled in this repository. `degradation-cogs.json` records the exact source object generations, file size, MD5, a SHA-256 of the first 16 KiB, native grid transform, band descriptions and the date on which partial downloads and browser CORS were checked. Rebuild the manifest with `node scripts/fetch-degradation-cogs.mjs`.

## Sources and attribution

- **Conservation International / Trends.Earth**, *Trends.Earth SDG Indicator 15.3.1 Datasets*, version 1.2, issued 2025-11-03. [DOI: 10.5281/zenodo.17514520](https://doi.org/10.5281/zenodo.17514520).
- [Publisher's data catalogue](https://docs.trends.earth/en/latest/for_users/downloads/index.html) links to the dataset and explains its relationship to UNCCD reporting guidance.
- [DOI metadata at DataCite](https://api.datacite.org/dois/10.5281/zenodo.17514520) supplies the published band definitions, coding, version and license.
- [Publisher's global processing notebook](https://github.com/ConservationInternational/trends.earth/blob/main/notebooks/TrendsEarth_Global_Data.ipynb) identifies the public `trendsearth-public` Google Cloud Storage bucket and its `unccd_reporting/2016-2023/` prefix. It also documents `OVERVIEW_RESAMPLING=MODE` and the Int16 no-data value.
- [Public source object metadata](https://storage.googleapis.com/storage/v1/b/trendsearth-public/o?prefix=unccd_reporting%2F2016-2023%2F&maxResults=100) lists the three alternate datasets, object generations, checksums and supplied download URLs.
- License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). Production was supported by the Global Environment Facility. Credit the three different productivity methods as Trends.Earth, FAO–WOCAT and European Commission Joint Research Centre (JRC) respectively.

The official Google Cloud Storage JSON API's supplied `mediaLink` is used because it returns browser CORS headers and supports/exposes HTTP 206 Content-Range. The XML-style storage URL does not supply browser CORS for this bucket. No credentials or proxy are used.

## What the mapped values mean

All three files have 14 signed 16-bit bands in geographic WGS84 (EPSG:4326), with no-data code **-32768**. Native grid scale is about 250 metres at the equator for Trends.Earth and FAO–WOCAT and about 309 metres for JRC. The pixel width in metres changes with latitude; the manifest preserves the exact angular scale and transform read from each actual TIFF, rather than assuming identical grids.

Band 14 is land-degradation **status in 2023 relative to the 2000–2015 baseline**, with seven categories: persistent degradation, recent degradation, baseline degradation, stability, baseline improvement, recent improvement and persistent improvement. Bands 1/5/10 contain the SDG indicator assessments for their stated periods, coded -1 (degradation), 0 (no change), 1 (improvement). Bands 2/6/11 contain land-productivity dynamics, coded 1 (declining), 2 (moderate decline), 3 (stressed), 4 (stable), 5 (increasing). Bands 3/7/12 contain land-cover degradation with -1/0/1 codes. Bands 4/8/13 contain **percentage change in soil organic carbon** in the 0–30 cm layer; they are not a -1/0/1 class layer.

Use the full native-resolution image to inspect a point. Precomputed overview images use the **mode** of categorical pixels. They may support a responsive overview map, but they hide minority classes and cannot support exact degraded-area percentages or stand in for native point values. Interpolation between categorical codes is invalid.

## Scientific and metadata limitations

These published global estimates follow UNCCD Good Practice Guidance and support national reporting. They are not a claim that a national authority has validated this particular pixel. They are not field measurements or a forecast probability. A match between a recent local vegetation series and this map is a comparison of evidence from different dates, not proof of present-day desertification.

The three alternative products change the productivity method while sharing land-cover and soil-carbon inputs. Their agreement is a **sensitivity check across productivity methods**, not three independent validations or a quantified accuracy score. Their disagreement should be retained and shown. Country-reported UN SDG percentages are separately sourced national context, never a substitute for local verification.

The published DOI metadata describes the last land-cover and soil-carbon periods (bands 12/13) as **2015–2022**, while the actual TIFF band descriptions read **2015–2023**. The manifest retains the TIFF descriptions and explicitly flags this discrepancy. Displaying "2015–2022/23 (source metadata differs)" is more defensible than claiming an independently verified 2023 endpoint for those two sub-indicators. The productivity period and final status are documented through 2023.

Existing deserts, bare rock, snow or low vegetation are not automatically desertification. Land degradation becomes desertification in the relevant dryland context; this app must not infer that distinction from low greenness or a national percentage. No-data, water masks, failed source requests and invalid class codes must stay unclassified.

## UNCCD dashboard service checked

The official UNCCD dashboard publicly lists country-specific SDG_STATUS_REPORTING rasters, for example [Mongolia's raster catalogue](https://data.unccd.int/api/countries/MNG/rasters/). The WMS capability response identifies a non-queryable layer and the tested endpoint did not allow cross-origin point access. The application therefore uses the publisher's openly available COGs and does **not** mislabel their pixel estimates as UNCCD nationally validated raster results.
