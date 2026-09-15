# Official land-degradation references

`unccd-reference.json` is a reproducible snapshot of the official UN Statistics Division SDG API, series **AG_LND_DGRD**, indicator **15.3.1: Proportion of land that is degraded over total land area (%)**. The custodian is UNCCD. Run `node scripts/fetch-unccd.mjs` to update it. The file records the retrieval timestamp, exact observation years, agency names, nature codes, raw values, units, footnotes and response SHA-256 hashes.

- [UN SDG API, complete series](https://unstats.un.org/SDGAPI/v1/sdg/Series/Data?seriesCode=AG_LND_DGRD&pageSize=1000)
- [UN SDG data portal](https://unstats.un.org/sdgs/dataportal/database)
- [Official indicator metadata](https://unstats.un.org/sdgs/metadata/files/Metadata-15-03-01.pdf)
- [UNCCD official dashboard](https://data.unccd.int/land-degradation)
- [UNCCD 2026 reporting manual, Strategic Objective 1](https://prais4-reporting-manual.unccd.int/en/2026/SO1.html)
- [UNCCD Good Practice Guidance v2](https://www.unccd.int/resources/manuals-and-guides/good-practice-guidance-sdg-indicator-1531-proportion-land-degraded)

## Meaning and limitations

The fetched national observations are 2015 and 2019, even though the snapshot is retrieved later. Retrieval time is **not** the observation date. Country-reported values (`Nature: C`) remain distinguished from other nature codes. Missing values, including the Republic of Korea in this snapshot, remain `null`; missing is not zero. World and regional aggregates are stored separately and are never substituted for a missing country value. The UNSD API and UNCCD dashboard may have different available estimates and should not be described as identical full coverage.

SDG 15.3.1 assesses land degradation using changes in land cover, land productivity and soil organic carbon. UNCCD integrates degradation evidence using the one-out-all-out approach, subject to national verification and contextual interpretation. A vegetation-index decline alone does not establish the full indicator. National percentages are **national context**, not pixel-level ground truth, local risk probabilities, a present-day measurement, or proof of desertification. Desertification concerns land degradation in drylands; existing deserts are not automatically degraded land. Local satellite comparisons must retain their own spatial scale, time window, quality flags and limits.

## Country lookup

`country-boundaries.json` contains the unmodified polygon geometry from [Natural Earth 1:50m Admin 0 Countries](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_admin_0_countries.geojson), reduced to the properties needed for country lookup. Natural Earth is [public domain](https://www.naturalearthdata.com/about/terms-of-use/). The source URL, retrieval time and original response SHA-256 are stored in the file. UN_A3, ISO_N3 or ISO_N3_EH supplies the UN M49 match; unresolved codes remain null.

These are generalized map boundaries, not authoritative national borders or a detailed land/water mask. Tiny islands, coastline detail and disputed areas can be unresolved. Ocean points never inherit the nearest country's percentage. Use the application's separate land/water mask before local land analysis.
