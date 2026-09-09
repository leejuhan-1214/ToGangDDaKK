# LAND:15 — 사막화 대응 3D 랩

[배포 사이트 열기](https://leejuhan-1214.github.io/ToGangDDaKK/)

[원본 프로젝트](https://github.com/leejuhan-1214/ToGangDDaKK)를 기반으로, [서울 3D Atlas](https://seoul-3d-atlas.synabreu.chatgpt.site/)의 지도 중심 탐색을 참고해 만든 교육용 사막화 의사결정 웹앱입니다.

## 바로 실행

Node.js 20 이상에서 별도 패키지 설치 없이 실행합니다.

```sh
node server.mjs
```

브라우저에서 http://127.0.0.1:4173 을 엽니다. 위성영상·표고·글꼴에는 인터넷 연결이 필요합니다. 지도 렌더러 MapLibre GL JS 5.14.0은 vendor/에 포함되어 있습니다.

## 주요 기능

- 고비·사헬·아랄해의 실제 위성영상과 표고 기반 3D 지도, 2D 전환, 밝기 연출, 자동 회전, 전체 화면
- 고정 분석 구역의 64 × 48 셀. 카메라 이동·회전은 분석값을 바꾸지 않음
- 지도에서 두 모서리를 선택하거나 현재 화면을 새 구역으로 지정
- NB + CA, Voronoi, Greedy, Prim + A*의 4개 단계와 레이어
- 위험 기준·가상 예산·모의 기간·CA 세대 조절
- 선정 셀에만 위험 감소를 적용하는 복원 전후 비교
- 지도 셀·복원 후보 선택, 6개 지표와 NB/CA 점수 확인
- 모든 셀의 합성 데이터 CSV 저장, 지역·조건·구역·복원 가정을 URL에 저장
- 모바일 반응형, 키보드 조작, reduced-motion 지원

## 실제 자료 / 합성값

Esri World Imagery와 AWS Terrain Tiles의 표고 자료는 실제 자료이며 실시간이 아닙니다. 지형 높이는 2배로 강조합니다. **환경지표·위험도·관리거점·비용·주민영향·복원 효과는 모두 교육용 합성값**입니다. NB 모수는 학습된 것이 아니며 위험점수는 보정된 예측확률이 아닙니다.

복원 후 가정은 선정 셀의 CA 위험점수를 0–50% 낮춥니다. 원본 셀을 수정하지 않고 별도 배열에서 계산합니다. 요약은 셀 면적 가중치로 계산하며 원본의 임의 ‘이전 기간 대비 변화율’과 근거 없는 복원 ha는 제거했습니다. CSV는 전·후 점수를 모두 포함합니다. 실제 복원 효과, 관측 추세, 길 안내나 정책 판단에 쓸 수 없습니다.

## 구조

- `index.html`, `styles.css`: 한국어 지도 중심 인터페이스
- `app.mjs`: MapLibre 레이어, 화면 상태, 사용자 조작, 내보내기
- `model.mjs`: 원본을 개선한 독립 계산 모듈
- `model.test.mjs`: 독립 수치 검증 12개
- `build.mjs`: 공개 정적 파일만 dist/로 복사
- `server.mjs`: 로컬 미리보기 서버
- `vendor/`: MapLibre GL JS 5.14.0와 BSD 3-Clause 라이선스
- `.github/workflows/pages.yml`: 검증 후 GitHub Pages 자동 배포

## 검증 / 빌드

```sh
node --check app.mjs
node --check model.mjs
node --test model.test.mjs
node build.mjs
```

12개 수치 테스트: NB 기준 사후값, CA 균일장·동기 갱신·경계, 경도 주기성, 구면 면적 적분, 지표면 최근접 구역, 예산 제약, 복원 불변성, 완전탐색 대비 Prim, 독립 Dijkstra 대비 A* 80개 사례.

이 작업에서는 브라우저를 직접 조작하는 UI 검증은 수행하지 않았습니다. WebMCP 지원 브라우저에서 `read_land15_analysis`, `configure_land15_scenario`가 조건부 등록됩니다. 지원 검증 컨텍스트가 없어 실제 WebMCP 호출은 미검증입니다. 지원하지 않는 브라우저에서는 일반 UI에 영향을 주지 않습니다.

## 알려진 한계

- 격자는 고정 64 × 48입니다. 새 구역을 만들면 셀 크기와 CA 경계 효과가 달라집니다.
- 분석 한도는 위도 −80°~80°, 가로 24°·세로 16°입니다. 거점은 전 지구 1° 격자에 고정한 가상점으로, 좁은 구역에는 거점이 없을 수 있습니다.
- Voronoi는 셀 단위 배정입니다. 경계가 계단 모양이며 색은 여러 거점에서 반복될 수 있습니다.
- Prim은 구면상의 거점 거리, A*는 4방향 격자의 합성 통행비용을 사용합니다. 실제 도로·경사·국경·통제는 반영하지 않습니다.
- 브라우저의 WebGL 및 외부 지도 서비스가 필요합니다. 외부 자료 장애를 안내하고 재시도를 제공합니다.
- URL은 설정만 담으며 카메라, 수동 레이어 선택, 셀 선택은 포함하지 않습니다.
- 서버 저장이나 계정 간 동기화가 없습니다.

## 출처와 참고

- 기존 알고리즘/과제: https://github.com/leejuhan-1214/ToGangDDaKK
- 지도 탐색 참고: https://seoul-3d-atlas.synabreu.chatgpt.site/
- 제공된 X 링크: https://x.com/synabreu/status/2096557555086725159 (접근 제한으로 원문 확인 불가)
- 위성영상: Esri, Maxar, Earthstar Geographics (지도 attribution 참조)
- 표고: https://registry.opendata.aws/terrain-tiles/ (원자료의 출처·라이선스 포함)
- 렌더러: https://maplibre.org/ (vendor/LICENSE-maplibre.txt)
- UN SDG 15: https://sdgs.un.org/goals/goal15

원본 저장소의 저작권·이용조건을 유지하며, 참고 Atlas의 코드·데이터는 복제하지 않았습니다. 원본에 없는 별도 오픈소스 라이선스를 이 프로젝트 전체에 임의로 부여하지 않습니다.

## GitHub Pages 배포

main에 푸시하면 Node.js 22에서 문법 검사와 12개 수치 테스트를 실행하고, node build.mjs로 만든 dist/만 GitHub Pages에 게시합니다. 공개 주소는 https://leejuhan-1214.github.io/ToGangDDaKK/ 입니다.
