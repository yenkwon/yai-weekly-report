# 주간 워라밸 보고 (yenny-balance-report)

매주 **주일 저녁**, 지난 한 주의 캘린더와 자기보고를 읽어 그 주의 기록(장면, 요일별 한 줄, 주제)과
지난주 대비 달라진 수치를 한 페이지로 만들고 **텔레그램으로 짧은 알림 + 링크**를 보내는 자동 파이프라인.



## 흐름
```
주일 18:00 KST ─ send ─▶ 해당 주 월~일 캘린더 fetch + 다음 주 미리보기 fetch + 자기보고 fetch
                       → 지난주·최근 4주 비교 + 특별 일정 탐지 + 168h 근거 계산
                       → 회고 작성 1회(Claude API, 실패시 계산형 대체) → 원문 겹침 검사 → Pages 갱신
                       → 텔레그램: 오프닝 + 장면 제목 + 가장 크게 달라진 것 + 링크

월 08:00 KST ─ reconcile ─▶ 답장 수면/수정사항 반영 → 재생성 → "반영 완료 ✅ + 새 링크"
수동 publish ─────────────▶ 텔레그램 재발송 없이 대시보드와 이력만 재생성
```

## 무엇을 보여주나
- **이번 주의 장면** — 그 주를 대표하는 순간 2~3개. 자기보고와 특별 일정에서 고릅니다.
- **요일별 한 줄** — 월~일 각 하루의 24시간 막대(30분 단위), 체감 점수, 한 문장. 자기보고가 없는 날은 일정으로만 쓰고 "기록 없음"으로 표시합니다.
- **내가 쓴 말의 주제** — 자기보고에서 반복된 생각 최대 4개와 최근 5주 중 몇 주에 나왔는지. 자기보고가 2일 미만이면 숨깁니다.
- **지난주와 달라진 것** — 의미 있게 변한 수치만 카드로 올리고, 전체 수치는 접힌 표에 둡니다. 추정 수면처럼 매주 같은 값은 카드에 오르지 않습니다.
- **최근 8주 흐름** — 수면·최대 부하·체감을 각각 따로 그립니다.
- **다음 주** — 미리보기 한 줄과 실험 하나.

## 주차 및 루틴 규칙
- 보고 기간은 **월요일~일요일**이며 제목은 `2026-W25 : 06.15 - 06.21`처럼 날짜 범위를 같이 표시.
- 출근일은 분기별로 자동 전환: **1·3분기 화/수**, **2·4분기 목/금**. 분기 경계 주간은 각 날짜의 실제 분기를 따른다.
- 주일은 토요일 양평 1박을 전제로 08:30 기상, 09:00 사역 준비, 10:00 교회 이동/찬양팀, 11:00~14:00 예배, 17:00 다음세대/청년부 종료로 계산.
- YJDS(양평예수제자학교, 안길함 목사님 사역)는 예은이 예배 반주로 섬기는 일정이며, 시작 1시간 전 준비·연습 시간을 자동 보강.

## 자기보고(주관) 레이어 — 구조만, 출처는 교체식
주간 보고는 **저장처를 모른다.** `selfReportAdapter.fetchWeek(range) → [{date, score, note}]` 만 호출.
- 하루 그릇은 최소: `{ date, score(1~5), note(한 줄 원문) }`. 분류·해석은 보고서/LLM이 *읽을 때* 수행.
- 어댑터: `NullAdapter`(기본, 빈 배열→주관 섹션 자동 숨김) · `ObsidianAdapter`(stub) · `TelegramAdapter`(stub) · `MockAdapter`(테스트).
- `SELF_REPORT_SOURCE=obsidian|telegram|null` 로 선택. **코덱스가 `ObsidianAdapter` 하나만 채우면** 나머지는 그대로.
- 옵시디언 컨벤션 권장: **점수는 프론트매터 `score: 4`**(정량 계산 안정), 한 줄 복기는 본문 자유 서술(해석은 LLM).

## 구성
| 파일 | 역할 |
|---|---|
| `src/compute.js` | 이벤트+루틴 템플릿 → 168h 모델·일별 블록·플래그·날짜매핑 |
| `src/weeklyAnalysis.js` | 주간·4주 비교(`changes` 상위 3개, `changesAll` 전체), 특별 일정, 수면 신뢰도, 다음 주 실험 후보 계산 |
| `src/weeklySynthesis.js` | Claude 회고 작성 1회(장면·요일별 한 줄·주제·실험) + 계산형 대체 + 주제 이어짐 계산 |
| `src/selfReport.js` | 자기보고 어댑터(Null/Obsidian/Telegram/Mock) |
| `src/fetchCalendar.js` | Google Calendar에서 지난주·다음주 이벤트 |
| `src/renderReportV2.js` | 텔레그램 알림 + 공개 데이터 최소화 + history 적립 |
| `src/publicPayload.js` | 공개용 가공(타임라인 30분 반올림·최근 8주 추세 화이트리스트) |
| `src/reflectionGuard.js` | 생성 문장이 자기보고·생활 업데이트 원문을 복사했는지 판정 |
| `templates/dashboard-v4.html` | 기록과 회고 중심의 현재 대시보드 |
| `src/index.js` | send / reconcile 오케스트레이터 |


캘린더에 넣지 않는 반복 일정은 `yai-worklife-agent/config/non-calendar-routines.json`을 단일 원천으로 사용합니다. 로컬에서는 인접 저장소를 자동 탐색하고, GitHub Actions에서는 `WORKLIFE_ROUTINES_PATH`로 체크아웃한 파일을 읽어 주간 시간 집계와 요약에 반영합니다.
| `templates/dashboard-v3.html` | 이전 시간 집계 중심 대시보드(롤백용, 미사용) |
| `templates/dashboard-v2.html` | 이전 텍스트 중심 대시보드(롤백용, 미사용) |
| `config/*.json` | 루틴·통근·회복목표 / 카테고리 매핑 |

## 셋업 (1회)
1. **Telegram**: 봇 토큰 + chat id (기존 AI뉴스 봇 재사용 가능) → `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
2. **Google Calendar**: OAuth refresh token (`calendar.readonly`) → `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN`.
3. **Claude 통합 해석(선택)**: GitHub 저장소 `Settings → Secrets and variables → Actions → New repository secret`에서 이름을 `ANTHROPIC_API_KEY`로 등록합니다. 없으면 폴백이 자동 동작합니다. 모델은 `WEEKLY_MODEL` 또는 `NOTE_MODEL`로 바꿀 수 있고 기본값은 `claude-sonnet-4-6`입니다.
4. **자기보고(선택)**: `SELF_REPORT_SOURCE` + 어댑터 구현. 미설정 시 객관 인사이트만.
5. **GitHub Pages**: `/docs` 배포, `PAGES_BASE_URL` 변수 설정.
6. `Actions → Run workflow (send)` 로 즉시 테스트.

## 로컬 테스트
```bash
npm install
node sample/full-test.js self   # 자기보고 포함 → sample/output 대시보드 생성
node sample/full-test.js        # 객관만(주관 섹션 숨김)
npm test                        # 다일 일정·수면 신뢰도·공개 데이터 테스트
```

PowerShell에서 Claude를 로컬 테스트할 때만 현재 터미널에 키를 넣습니다.

```powershell
$env:ANTHROPIC_API_KEY='발급받은 키'
node sample\full-test.js self
```

## 분석 이력과 공개 범위
- 공개 저장소의 `data/history.json`에는 주간 합계와 비율 같은 집계값만 저장합니다.
- 일정 **원문 제목, 캘린더명, 분류, 시작·종료, 소요시간**은 비공개 `yai-worklife-agent/store/weekly-event-history.json`에 저장합니다.
- 참석자, 장소, 설명은 수집하거나 저장하지 않습니다.
- GitHub Pages HTML에는 전체 일정 이력과 자기보고·생활 업데이트 **원문**을 넣지 않습니다.
- 장면, 요일별 한 줄, 주제는 원문을 바탕으로 **다시 쓴 글**입니다. 내용에는 제한을 두지 않지만(사람, 업무, 건강 포함), 생성 문장이 원문과 정규화 기준 20자 이상 겹치면(짧은 원문은 통째로 들어 있으면) 그 문장을 버리고 일정 기반 문장으로 바꿉니다. 규칙은 `test/reflection.test.js`가 잠급니다.
- `data/history.json`에는 주제의 **이름만** 쌓습니다. 주제 설명, 장면, 요일별 문장은 그 주 페이지에만 있습니다. 새 페이지에는 `noindex`가 들어갑니다.

- 장면, 요일별 한 줄, 주제는 원문을 바탕으로 **다시 쓴 글**입니다. 내용에는 제한을 두지 않지만(사람, 업무, 건강 포함), 생성 문장이 원문과 정규화 기준 20자 이상 겹치면(짧은 원문은 통째로 들어 있으면) 그 문장을 버리고 일정 기반 문장으로 바꿉니다. 규칙은 `test/reflection.test.js`가 잠급니다.
- `data/history.json`에는 주제의 **이름만** 쌓습니다. 주제 설명, 장면, 요일별 문장은 그 주 페이지에만 있습니다. 새 페이지에는 `noindex`가 들어갑니다.

- 대시보드 타임라인은 분 단위 `dayBlocks`가 아니라 **30분 단위로 반올림한 파생본**입니다. 원본은 공개 페이로드에서 삭제되고, 반올림·병합 규칙은 `test/weekly-v2.test.js`가 잠급니다.
- 8주 추세는 `data/history.json`에서 **허용된 키만 복사**해 넣습니다. 상위 저장소에 새 필드가 생겨도 기본값은 비공개입니다.
- GitHub Actions는 `WORKLIFE_REPO_TOKEN`으로 비공개 이력을 읽고 갱신한 뒤, 공개 리포트에는 필요한 파생 결과만 커밋합니다.

## 수동 보정 레이어
LLM API 없이 내용 보정이 필요할 때는 `data/corrections.json`에 주차별로 적습니다.
자동 리포트는 이 파일을 읽어 수면·분류·메모 보정을 계산 전 반영합니다.

```json
{
  "2026-W24": {
    "sleepOverride": { "thu": 5, "fri": 5.5 },
    "categoryOverrides": [
      { "title": "yai-digest", "bucket": "growth", "note": "개인 프로젝트 학습/제작 시간" }
    ],
    "notes": [
      "수요일 yai-digest 작업은 생활 시간이 아니라 개인 프로젝트 학습/제작 시간으로 해석."
    ]
  }
}
```

- `sleepOverride`: `mon/tue/wed/thu/fri/sat/sun` 또는 `월/화/수/목/금/토/일` 사용.
- `categoryOverrides`: `title`은 정확한 제목, `match`는 정규식. `bucket`은 `config/category-map.json`의 bucket 중 하나.
- `notes`: 대시보드와 텔레그램 요약에 보정 메모로 표시.
