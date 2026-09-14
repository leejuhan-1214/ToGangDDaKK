# 연도 비교 자료와 범위

`history.json`은 공개 NASA 자료에서 생성한 작은 스냅샷입니다. 기존 위험도와 복원 효과를 생성하는 교육용 모형과 별도로 표시합니다. 지역 대표점의 식생·강수 시계열을 지역 전체 평균 또는 관측 기반 사막화 확률로 해석하지 않습니다.

## 지도: NASA GIBS

두 연도의 지도를 같은 계절로 비교하기 위해 2001·2010·2020·2025년을 선택했습니다.

| 항목 | 식생지수 | 위성사진 |
| --- | --- | --- |
| 레이어 | `MODIS_Terra_L3_NDVI_Monthly` | `MODIS_Terra_CorrectedReflectance_TrueColor` |
| 날짜 | 각 연도 8월 1일로 식별되는 월 합성 | 각 연도 8월 13일 |
| 좌표계 | EPSG:3857 | EPSG:3857 |
| TileMatrixSet | `GoogleMapsCompatible_Level7` | `GoogleMapsCompatible_Level9` |
| 원본 최대 줌 | 7 | 9 |
| 타일 | 256 × 256 PNG | 256 × 256 JPEG |

MapLibre XYZ URL은 `imagery.ndvi.tileUrlTemplate` 및 `imagery.trueColor.tileUrlTemplate`에 있습니다. `{date}`를 `dateByYear[year]`로 바꾸고 `{z}/{y}/{x}`는 지도 라이브러리에 맡깁니다. `tileSize:256`과 `maxzoom`을 소스에 설정하면 원본 최대 줌을 넘는 확대는 재표시만 수행합니다.

식생 색상은 NASA의 `MODIS_L3_NDVI` 공식 색 범례를 사용합니다. NDVI 0 이하와 결측은 이 영상에서 투명하게 표시됩니다. 낮은 NDVI가 있는 자연 사막·암석 지대가 곧 진행 중인 사막화를 뜻하지는 않습니다. 위성사진은 일별 관측이라 구름 또는 관측 공백이 있을 수 있습니다.

- [GIBS 접근 문서](https://nasa-gibs.github.io/gibs-api-docs/access-basics/)
- [현재 WMTS 레이어·기간·타일 규격](https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml)
- [공식 NDVI 색 범례](https://gibs.earthdata.nasa.gov/legends/MODIS_L3_NDVI_H.svg)
- [색상과 수치 구간 원본 XML](https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_L3_NDVI.xml)

## 그래프: 지역 중심의 실제 자료

| 지역 키 | 경도 | 위도 | 공간 범위 |
| --- | ---: | ---: | --- |
| gobi | 104.85 | 45 | 지역 중심 대표점 |
| sahel | -14.65 | 15.5 | 지역 중심 대표점 |
| aral | 62.5 | 44.65 | 지역 중심 대표점 |

### 강수량

NASA POWER의 `PRECTOTCORR` 월별 API에서 2001~2025년 자료를 받았습니다. 응답이 명시한 기상 원자료는 MERRA-2 재분석이며, 현장 우량계 관측 자체가 아닙니다. POWER 대표점의 원자료 격자 해상도가 적용되므로 MODIS 250m 픽셀과 동일한 공간 해상도로 보지 않습니다.

API 단위는 `mm/day`입니다. 각 월의 평균 일강수량에 실제 달력상의 월 일수(윤년 포함)를 곱하고 12개월을 더해 `precipitationMm`을 계산합니다. API가 월 평균을 소수점 둘째 자리로 반올림하므로 계산 결과는 근사 연합계입니다. 13번째 월 코드는 연평균이므로 합계에 더하지 않습니다. 한 달이라도 결측·음수이면 그 해의 연합계는 `null`입니다. `monthlyMeanMmPerDay`에 계산에 사용한 12개 원값을 보존합니다.

- [NASA POWER 월·연 API 문서](https://power.larc.nasa.gov/docs/services/api/temporal/monthly/)
- [NASA POWER 자료 출처와 해상도 설명](https://power.larc.nasa.gov/docs/faqs/data/)
- 정확한 요청 URL과 원자료 출처는 각 지역의 `sources`에 보존합니다.

### NDVI

ORNL DAAC TESViS의 `MOD13Q1` Collection 6.1 자료를 사용합니다. 각 지역 중심을 포함하는 명목상 250m 픽셀 하나이며, API 응답의 실제 사인곡선 투영 격자 크기는 약 231.66m입니다. 매년 연중 225일에 시작하는 16일 합성을 선택했습니다. 평년에는 8월 13일, 윤년에는 8월 12일이며 실제 응답 날짜를 `ndviDate`로 저장합니다. **지도는 8월 월 합성, 그래프는 대표점의 8월 중순 16일 합성이므로 집계기간이 서로 다릅니다.**

수치는 원값에 `0.0001`을 곱합니다. 원값이 유효 범위(-2000~10000)에 있고, `pixel_reliability = 0`, MODLAND QA 비트 0–1이 0, 육지/수역 비트 11–13이 1인 경우에만 채택합니다. 그 외 품질 불충분·수역·결측은 `null`이며 보간하거나 가상 값을 넣지 않습니다. 원값, 품질 지표, 투영 격자 위치와 개별 요청 URL도 남깁니다.

- [ORNL DAAC TESViS REST 서비스 설명](https://modis.ornl.gov/data/modis_webservice.html)
- [MOD13Q1 Collection 6.1 원자료](https://doi.org/10.5067/MODIS/MOD13Q1.061)
- [MODIS C6.1 사용자 안내서: 품질 표 4·5](https://lpdaac.usgs.gov/documents/621/MOD13_User_Guide_V61.pdf)
- 서비스 인용: ORNL DAAC (2018), [TESViS RESTful Web Service](https://doi.org/10.3334/ORNLDAAC/1600).

## 재현과 검증

프로젝트 루트에서 `node scripts/fetch-history.mjs`로 다시 생성합니다. Node.js 22 이상과 네트워크 연결이 필요하며 API 키·계정·비밀 값은 사용하지 않습니다. 요청 결과는 저장소 바깥의 `../history-data/`에 캐시합니다. 이 캐시는 배포하지 않습니다.

스크립트는 GIBS capabilities에서 지원 레이어·날짜·256px 타일 규격을 확인하고, 고비·아랄 대표점의 네 연도 NDVI/위성사진 타일을 실제 요청합니다. NDVI PNG를 디코딩해 비투명 픽셀과 여러 색상이 존재하는지 확인합니다. JPEG는 서명과 유의미한 바이트 크기를 확인합니다. 이미지가 구름 없이 보이는지까지 이 자동 검사가 보장하지는 않습니다.

검증 시각·HTTP 상태·CORS 응답·요청 URL·타일 SHA-256 및 픽셀 통계는 `verification`에 있습니다. GIBS와 ORNL은 키 없이 공개 요청할 수 있습니다. 실제 배포 Origin을 보낸 요청에서 GIBS와 POWER는 `Access-Control-Allow-Origin: *`, ORNL은 요청한 GitHub Pages Origin을 허용했습니다. 그래프는 같은 GitHub Pages 출처에서 `history.json`을 읽으므로 NASA POWER의 직접 브라우저 CORS 지원에 의존하지 않습니다. CSV 원파일 식별자의 `.061.`도 확인하여 `collectionFileIdentifier`에 보존합니다.

2026년 9월 14일 수집에서 사헬 2020·2025년 NDVI는 구름 품질(rank 3) 때문에 `null`입니다. 고비·아랄의 네 기준 연도와 사헬 2001·2010년은 품질 검사를 통과했습니다. 결측 양쪽 값을 선으로 연결하거나 다른 연도로 대체하지 않습니다.

## JSON 계약

- `years`: 비교 선택지 네 연도.
- `imagery.ndvi` / `imagery.trueColor`: 타일 URL 템플릿, 날짜 맵, 타일 크기, 최대 줌, 출처.
- `regions[id].series`: 네 비교 연도의 `year`, `precipitationMm`, `ndvi`, `ndviDate`, 원자료·품질 정보.
- `regions[id].precipitationSeries`: 2001~2025년 25개 연강수 값과 계산용 월값.
- `regions[id].coordinate`: 경도, 위도 순서의 대표점. `scope`는 지역 전체 평균이 아님을 명시합니다.
- `null`은 자료 없음 또는 품질 기준 미충족입니다. UI는 0으로 대체하면 안 됩니다.
