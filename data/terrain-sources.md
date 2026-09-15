# 실제 3D 지형의 출처와 검증 범위

확인일: 2026-09-15. 이 문서는 배경 지형의 출처를 설명합니다. 지형의 사실성이 사막화 분석의 정확도를 보증하지는 않습니다.

## 높이와 영상

- 높이: [Mapterhorn 공개 표고](https://mapterhorn.com/data-access/)의 `https://tiles.mapterhorn.com/{z}/{x}/{y}.webp`. 공식 [TileJSON](https://tiles.mapterhorn.com/tilejson.json)은 XYZ, Terrarium 인코딩, 512×512 픽셀을 명시합니다.
- 전 지구 기본자료는 Copernicus GLO-30입니다. Mapterhorn은 지역에 따라 국가 측량기관의 상세 자료도 결합합니다. 원자료·라이선스는 [공식 출처 목록](https://mapterhorn.com/attribution/)과 [기계 판독 목록](https://download.mapterhorn.com/attribution.json)에 있습니다. 예: Copernicus GLO-30(30 m), swisstopo swissALTI3D, USGS 3DEP. 특정 좌표에 어느 상세자료가 반영됐는지 이 앱이 독립 확인한 것은 아닙니다.
- 앱은 전 지구 공통 범위를 사용하기 위해 DEM 최대 줌을 12로 제한합니다. 이후 확대는 기존 표고의 보간입니다. 상세 지역의 줌 13–17 원자료를 모두 제공하는 구현은 아닙니다. 512 픽셀은 타일 크기이며 지상 해상도 512 m를 뜻하지 않습니다.
- 영상: [Esri World Imagery](https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer). 위성·항공 영상은 지역별로 촬영일과 상세도가 다릅니다. 현재 시점의 생중계 영상이 아닙니다.

MapLibre GL JS 5.14.0이 표고 타일을 해독하여 지형 메시를 만들고 위에 영상을 씌웁니다. 높이 배율은 **1×**입니다. 영상의 밝기·갈색 정도를 높이로 바꾸거나 임의의 산을 추가하지 않습니다. Terrarium 값은 `R×256 + G + B/256 − 32768` m로 읽으므로 해수면 아래의 표고도 보존됩니다.

## 음영

표고와 음영은 같은 원자료를 각각의 지도 소스로 읽습니다. 음영은 DEM의 경사와 방향에서 계산하는 MapLibre의 다방향 hillshade입니다. 북쪽을 기준으로 270°, 315°, 0°, 45°에서 고도각 45°의 약한 조명을 적용합니다. 지도 회전에 따라 광원이 화면에 붙어서 돌지 않습니다. [MapLibre 공식 예제](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-multidirectional-hillshade-layer/)

이것은 지형의 형태를 읽기 위한 시각화입니다. 촬영 당시 태양 위치, 구름, 산이 다른 지형에 드리우는 차폐 그림자를 복원한 결과는 아닙니다. ‘자연색’은 영상에 채도·대비 강화를 더하지 않으며, 나머지 색감은 표시 설정입니다.

## 소스 일관성 점검

작업 중 공개 타일을 직접 해독한 결과입니다. 세 해역은 줌 10 타일의 **262,144개 픽셀 전체**를 검사했습니다. 나머지는 지정 좌표의 타일 픽셀 표본입니다.

| 위치 | 경도, 위도 | 점검 결과 |
| --- | --- | --- |
| 태평양 | 150, 0 | `10/938/512.webp` 전체 0 m |
| 동해 | 131, 37 | `10/884/398.webp` 전체 0 m |
| 황해 | 124, 35 | `10/864/405.webp` 전체 0 m |
| 고비 | 104, 43.5 | 표본 2,415 m, 해당 타일 1,581–2,794 m |
| 사해 | 35.47, 31.5 | 표본 −432 m, 해당 타일 −432–968 m |
| 에베레스트 부근 | 86.925, 27.988 | 표본 8,711 m |

이는 디코딩 오류, 바다의 가짜 굴곡, 음수 표고의 잘림을 확인하는 **소스 일관성 점검**입니다. 독립 측량 자료와의 수직·수평 정확도 검증이 아닙니다. 봉우리의 실제 최고점과 지도 픽셀 평균은 다를 수 있습니다. 위성 표고는 수목·건물 영향, 해상도, 보간, 측정 시기 및 원자료 오차를 포함합니다.

별도로 앱의 전체 지도 스타일을 번들된 MapLibre 5.14.0의 실제 스타일 검증기에 통과시켰습니다. 의도적으로 숫자 배열에 문자열을 넣은 대조군은 거부되어 검증기가 작동함도 확인했습니다. 기존 52개 자동 검사를 실행하여 모두 통과했습니다. 렌더링 외형과 카메라 동작은 브라우저 검사가 별도로 필요합니다.

## Google Earth와 건물 메시

현재 제공하는 것은 실제 표고에 근거한 입체 지형입니다. 건물 외벽과 개별 수목까지 촬영해 재구성한 전 세계 사진측량 메시를 제공한다고 표시하지 않습니다. Google의 [Photorealistic 3D Tiles](https://developers.google.com/maps/documentation/tile/overview)를 앱에 넣으려면 [결제가 활성화된 프로젝트와 API 키 또는 OAuth](https://developers.google.com/maps/documentation/tile/usage-and-billing)가 필요합니다. 이 작업에서 새 결제 계정이나 유료 사용을 설정하지 않았습니다.

국가별 실제 3D 도시자료의 예로 일본 국토교통성의 [PLATEAU 및 공개 3D Tiles](https://docs.plateauview.mlit.go.jp/datasets/3d-tiles/)와 스위스 정부의 [공식 3D 지도](https://www.geo.admin.ch/en/map-viewer-help-navigation-and-orientation)가 있습니다. 해당 국가·도시의 제공 범위에 한정되며 이 앱에 이들 건물 메시가 통합되어 있다는 뜻은 아닙니다.
