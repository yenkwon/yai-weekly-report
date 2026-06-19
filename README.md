# 주간 워라밸 보고 (yenny-balance-report)

매주 **일요일 저녁**, 지난 한 주의 캘린더(+선택적 자기보고)를 읽어 168시간 워라밸 대시보드를 만들고
**텔레그램으로 따뜻한 한 줄 + 요약 + 인터랙티브 링크**를 보내는 자동 파이프라인.

## 흐름
```
일 20:00 KST ─ send ─▶ 지난주 캘린더 fetch + 다음주 미리보기 fetch + 자기보고 fetch
                       → 168h 계산(루틴 추정 수면) → 5렌즈 인사이트 + 이례치 + 미리보기
                       → 따뜻한 한 줄(Claude API, 실패시 폴백) → Pages 갱신
                       → 텔레그램: 한 줄 + 요약 + 링크 + "이번 주 수면은?"(force_reply)
일 21:30 KST ─ reconcile ─▶ 답장 수면 반영 → 재생성 → "반영 완료 ✅ + 새 링크"
```

## 무엇을 보여주나
- **따뜻한 한 줄(오프닝 노트)** — 매주 톤이 바뀌는 사람 목소리. 그 주의 구체적 디테일을 물고 들어감. (Claude API; 없으면 데이터 기반 폴백)
- **이번 주의 발견** — 4주 평소 대비 가장 다른 점을 자동 포착(매주 답이 달라짐). "가장 긴 날" 고정 슬롯을 대체.
- **다섯 렌즈 복기** — ① 타인 vs 나 ② 회복 부채(누적) ③ 리듬(쏠림·심야) ④ 지킴 vs 무너짐(양방향 streak) ⑤ 체감 vs 실제(자기보고 있을 때만).
- **다음 주 미리보기 + 추천** — 다음 주 충돌(격주 반주+라이딩 겹침 등) 경고 + 데이터 기반 우선순위 추천.

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
| `src/insights.js` | 5렌즈 + 이례치 발견 + 다음주 미리보기 + 추천 |
| `src/openingNote.js` | 따뜻한 한 줄 (Claude API + 폴백, voice 가이드 내장) |
| `src/selfReport.js` | 자기보고 어댑터(Null/Obsidian/Telegram/Mock) |
| `src/fetchCalendar.js` | Google Calendar에서 지난주·다음주 이벤트 |
| `src/renderReport.js` | 텔레그램 요약 + 대시보드 HTML 주입 + history 적립 |
| `src/index.js` | send / reconcile 오케스트레이터 |
| `templates/dashboard.html` | 데이터 주입형 인터랙티브 대시보드 |
| `config/*.json` | 루틴·통근·회복목표 / 카테고리 매핑 |

## 셋업 (1회)
1. **Telegram**: 봇 토큰 + chat id (기존 AI뉴스 봇 재사용 가능) → `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
2. **Google Calendar**: OAuth refresh token (`calendar.readonly`) → `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN`.
3. **따뜻한 한 줄(선택)**: `ANTHROPIC_API_KEY` (없으면 폴백 문구 자동). 모델은 `NOTE_MODEL`(기본 claude-sonnet-4-6).
4. **자기보고(선택)**: `SELF_REPORT_SOURCE` + 어댑터 구현. 미설정 시 객관 인사이트만.
5. **GitHub Pages**: `/public` 배포, `PAGES_BASE_URL` 변수 설정.
6. `Actions → Run workflow (send)` 로 즉시 테스트.

## 로컬 테스트
```bash
npm install
node sample/full-test.js self   # 자기보고 포함 → outputs 대시보드 생성
node sample/full-test.js        # 객관만(주관 섹션 숨김)
```

## 확장(v2)
- `openingNote`는 이미 Claude API. 다음 단계는 자기보고 `note` 7줄의 정서적 아크 요약을 같은 호출에 합치는 것.
- 회복 부채의 '빈 시간' 보정은 자기보고 score가 안정적으로 들어오면 활성화(현재는 수면+자기돌봄만 정량).
