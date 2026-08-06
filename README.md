# 주간 워라밸 보고 (yenny-balance-report)

매주 **주일 저녁**, 지난 한 주의 캘린더(+선택적 자기보고)를 읽어 168시간 워라밸 대시보드를 만들고
**텔레그램으로 따뜻한 한 줄 + 요약 + 인터랙티브 링크**를 보내는 자동 파이프라인.

## 흐름
```
주일 18:00 KST ─ send ─▶ 해당 주 월~일 캘린더 fetch + 다음주 미리보기 fetch + 자기보고 fetch
                       → 지난주·최근 4주 비교 + 특별 일정 탐지 + 168h 근거 계산
                       → 통합 해석 1회(Claude API, 실패시 폴백) → Pages 갱신
                       → 텔레그램: 한 줄 + 요약 + 링크 + "이번 주 수면은?"(force_reply)
월 08:00 KST ─ reconcile ─▶ 답장 수면/수정사항 반영 → 재생성 → "반영 완료 ✅ + 새 링크"
수동 publish ─────────────▶ 텔레그램 재발송 없이 대시보드와 이력만 재생성
```

## 무엇을 보여주나
- **이번 주 달라진 3가지** — 지난주와 최근 4주 평균을 함께 표시합니다.
- **새롭거나 특별했던 일정** — 원문 일정 이력으로 첫 등장, 평소보다 긴 일정, 요일 이동, 심야·종일 일정을 찾습니다.
- **체감과 실제** — 자기보고와 일정 부하를 연결하되, 수면이 추정치면 회복 여부를 단정하거나 부채를 누적하지 않습니다.
- **통합 인사이트** — 계산된 사실을 Claude가 한 번에 오프닝·해석·다음 주 실험 하나로 작성합니다. API가 없거나 실패하면 계산형 폴백을 사용합니다.
- **168시간 분배** — 결론이 아닌 해석 근거로 뒤에 배치합니다. 자정을 넘는 일정은 날짜별 실제 겹친 시간으로 나눕니다.

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
| `src/weeklyAnalysis.js` | 주간·4주 비교, 특별 일정, 수면 신뢰도, 다음 주 실험 후보 계산 |
| `src/weeklySynthesis.js` | Claude 통합 해석 1회 + 계산형 폴백 |
| `src/selfReport.js` | 자기보고 어댑터(Null/Obsidian/Telegram/Mock) |
| `src/fetchCalendar.js` | Google Calendar에서 지난주·다음주 이벤트 |
| `src/renderReportV2.js` | 텔레그램 요약 + 공개 데이터 최소화 + history 적립 |

캘린더에 넣지 않는 반복 일정은 `yai-worklife-agent/config/non-calendar-routines.json`을 단일 원천으로 사용합니다. 로컬에서는 인접 저장소를 자동 탐색하고, GitHub Actions에서는 `WORKLIFE_ROUTINES_PATH`로 체크아웃한 파일을 읽어 주간 시간 집계와 요약에 반영합니다.
| `src/index.js` | send / reconcile 오케스트레이터 |
| `templates/dashboard-v2.html` | 변화와 특별 일정을 먼저 보여주는 대시보드 |
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
- GitHub Pages HTML에는 전체 일정 이력과 자기보고 원문을 넣지 않습니다. 선택된 특별 일정과 파생 인사이트만 표시합니다.
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
