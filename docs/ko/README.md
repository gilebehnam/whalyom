<p align="center"><img src="../../assets/brand/hero.svg" alt="Whalyom: Claude Code 내부에서 실행되는 마케팅 부서 전체" width="100%"></p>

<p align="center"><img alt="license" src="https://img.shields.io/badge/license-MIT-2b6cb0"> <img alt="agents" src="https://img.shields.io/badge/agents-536-F2C230"> <img alt="skills" src="https://img.shields.io/badge/skills-498-7FE6F2"> <img alt="departments" src="https://img.shields.io/badge/departments-28-7FE6F2"> <img alt="commands" src="https://img.shields.io/badge/commands-106-7FE6F2"> <img alt="rules" src="https://img.shields.io/badge/rules-50-9BE7A2"> <img alt="verified facts" src="https://img.shields.io/badge/verified%20facts-1%2C152-9BE7A2"></p>

<p align="center"><a href="../../README.md">English</a> · <a href="../../README.fa.md">فارسی</a> · <a href="../ar/README.md">العربية</a> · <a href="../tr/README.md">Türkçe</a> · <a href="../es/README.md">Español</a> · <a href="../de/README.md">Deutsch</a> · <a href="../fr/README.md">Français</a> · <a href="../zh-CN/README.md">简体中文</a> · <a href="../ja/README.md">日本語</a> · <a href="../pt-BR/README.md">Português (Brasil)</a> · <b>한국어</b></p>

<p align="center"><a href="../../STORY.md">스토리</a> · <a href="../COMMANDS.md">명령어</a> · <a href="../../rules/README.md">규칙</a></p>

# Whalyom

**Claude Code 내부에서 실행되는 완전한 마케팅 부서. 무료 오픈소스.**

훌륭한 제품을 만들었습니다. 하지만 제품을 만드는 것이 쉬운 부분이었음을 깨닫게 됩니다.
Whalyom은 Claude Code에 전체 마케팅 부서를 부여합니다. 28개 부서에 배치된 536개의 AI 에이전트가 각각의 리더, 명확한 임무, 스킬 패키지를 갖추고 있습니다.
필요한 대상을 찾고, 전해야 할 메시지를 작성하며, 모든 리드가 성사될 때까지 안내하고, 효과가 있었던 결과로부터 학습합니다.
사용자의 최종 승인 없이는 아무것도 외부에 발송되지 않습니다.

```text
find -> plan -> make -> review -> you approve -> send -> measure -> learn
```

## 주요 수치

| | |
|---|---:|
| AI 에이전트 (부서 리더 30명, 빠른 단일 작업을 위한 마이크로 에이전트 59개) | **536** |
| 부서 수 (총괄 지휘부터 자가 진화까지 6개 계층) | **28** |
| 스킬 수 (SEO 감사부터 초기 디스커버리 통화까지) | **498** |
| 바로 사용 가능한 슬래시 명령어 | **106** |
| 규칙 수 (모두 코드로 강제 집행됨) | **50** |
| 사전 구성된 멀티 에이전트 워크플로 | **22** |
| 28개 주제에 걸친 46개 공식·학술 출처 기반 검증된 지식 팩트 | **1,152** |
| 엔진 스크립트 (Node 기반, 단 2개의 npm 의존성) | **73** |

위의 모든 수치는 `npm run stats` 실행 시 파일에서 직접 계산됩니다.

## 1분 설치 가이드

**Claude Code 플러그인으로 설치:**

```bash
claude plugin marketplace add gilebehnam/whalyom
claude plugin install whalyom@whalyom
```

**전체 워크스페이스로 설치 (전체 엔진, 로컬 커맨드 센터 및 데몬 포함):**

```bash
git clone https://github.com/gilebehnam/whalyom.git whalyom
cd whalyom
./install.sh          # runs npm install
claude
```

**Windows 환경** (PowerShell, 클론한 폴더 내 실행):

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
claude
```

커넥터(이메일, 광고, 소셜 미디어, 결제)는 선택 사항입니다. `.env.example`을 `.env`로 복사하고 필요한 항목만 설정하세요 ([docs/CONNECTORS.md](../CONNECTORS.md)).

**Codex 사용 시:** `./install.sh --codex` (Windows: PowerShell 명령어 뒤에 `-Codex` 추가)를 실행하면 스킬과 명령어가 `~/.codex`에 설치되며, `AGENTS.md`가 Codex에 시스템 동작 방식을 설명합니다.

샘플 제품으로 먼저 테스트해 보세요: `node tools/build-state.mjs && npm run command-center` 실행 후 http://localhost:4321 에 접속합니다.

이후 Claude Code에서 다음을 실행합니다:

```text
/whalyom-new my-shop myshop.com
/whalyom-onboard my-shop
/autopilot my-shop
```

온보딩 과정에서 웹사이트를 크롤링하고 구매자와 경쟁사를 매핑하며, 증명 가능한 클레임과 30일 성장 계획을 작성합니다.
오토파일럿은 각 부서를 순차적으로 가동하며, 모든 초안을 승인 대기 상태로 `outbox/`에 보관합니다.

## 주요 기능

| 상황 | 명령어 | 실행 내용 |
|---|---|---|
| 명확한 현재 상태 점검 | `/site-audit` | SEO, AI 검색, 성능, 전환율, 신뢰도 분석 및 우선순위 상위 10개 수정안 제시 |
| 성장 계획 수립 | `/growth-plan` | 매출 목표, 채널 믹스, 에이전트 작업 순서 설계 |
| Google 검색 노출 확보 | `/seo-sprint` | 클러스터링, 브리프, 기사 작성, 스키마 마크업, 내부 링크 및 색인 생성 |
| AI 어시스턴트 인용 확보 | `/ai-search` | 인용 가능한 콘텐츠 블록, llms.txt, 엔티티 작업, 엔진별 응답 점유율 관리 |
| 광고비 없는 무료 유입 | `/free-growth` | 시간 단위로 계획된 무료 성장 채널 및 추적 링크 생성 |
| 예산 낭비 없는 유료 광고 | `/paid-ads` | 월 $100 미만으로 채널별 순차 집행 및 소재별 자동 중단 규칙 적용 |
| 모든 리드에 대한 응대 | `/leads` · `/lead-to-sale` | 리드 스코어링, 담당자 지정, 후속 조치 및 퍼널 이동 |
| 신규 런칭 캠페인 | `/launch` | Product Hunt, Hacker News, Reddit, 뉴스레터 대상 D-14부터 D+7까지 실행 |
| 성과 요인 분석 | `/attribution` · `/weekly-retro` | 5가지 기여 모델, 간이 MMM 분석 및 차주 실행 인사이트 도출 |

전체 106개 명령어 목록: [docs/COMMANDS.md](../COMMANDS.md).

**시작:** `/whalyom-new` · `/whalyom-onboard` · `/site-audit`

**계획 및 실행:** `/growth-plan` · `/autopilot` · `/autopilot-all` · `/mega-sweep` · `/next-wave`

**성장:** `/seo-sprint` · `/ai-search` · `/content-engine` · `/landing` · `/free-growth` · `/paid-ads` · `/launch` · `/localize` · `/competitors`

**영업:** `/leads` · `/lead-to-sale` · `/crm` · `/sequences` · `/inbox` · `/lifecycle` · `/cro`

**측정:** `/attribution` · `/ab-test` · `/weekly-retro` · `/report`

**가드레일:** `/approvals` · `/brand-check` · `/kill-switch` · `/budget`

**브랜드 및 제품:** `/positioning` · `/message-house` · `/offer` · `/pricing-review` · `/naming` · `/icp` · `/jobs-to-be-done` · `/product-messaging` · `/release` · `/enablement` · `/case-study` · `/battlecard`

**콘텐츠 및 미디어:** `/article` · `/edit` · `/humanize` · `/newsletter` · `/social-posts` · `/linkedin` · `/video-script` · `/video-cut` · `/captions` · `/podcast` · `/webinar` · `/lead-magnet` · `/free-tool` · `/ads-copy` · `/email-sequence`

**파트너, PR 및 커뮤니티:** `/press` · `/press-kit` · `/reviews` · `/crisis` · `/affiliates` · `/creators` · `/partners` · `/community` · `/ambassadors` · `/events` · `/meetup` · `/summit` · `/reddit` · `/product-hunt`

**고객 관리:** `/onboarding` · `/support-faq` · `/support-macros` · `/health-score` · `/churn` · `/win-back` · `/referrals` · `/survey` · `/customer-voice`

**로컬 및 커머스:** `/local-profile` · `/citations` · `/local-ads` · `/promo` · `/marketplaces` · `/shopping-feed` · `/unit-economics`

**데이터 및 AI:** `/tracking` · `/tags` · `/stack-audit` · `/site-change` · `/speed` · `/segments` · `/forecast` · `/ai-agent` · `/ai-readiness` · `/privacy` · `/compliance`

**시스템:** `/knowledge` · `/evolve` · `/self-heal` · `/command-center` · `/daemon` · `/workforce`

## 28개 부서 구조

| 부서 | 에이전트 수 | 리더 |
|---|---:|---|
| Programmatic SEO & AEO | 50 | `om-mega-seo` |
| Market OSINT & Intelligence | 34 | `om-mega-intel` |
| Organic Social & Distribution | 29 | `om-mega-social` |
| Funnel & CRO | 27 | `om-mega-funnel` |
| FinOps & Attribution | 26 | `om-mega-finops` |
| Self-Healing & Evolution | 26 | `om-mega-evolve` |
| Paid Media | 25 | `om-mega-paid` |
| Creative Studio | 23 | `om-mega-creative` |
| Sales Closing | 22 | `om-mega-closer` |
| Strategy Consulting Practice | 22 | `om-mega-consulting` |
| Lifecycle & Retention | 21 | `om-mega-lifecycle` |
| AI Engineering & Agentic Systems | 21 | `om-mega-ailab` |
| International & Localization | 19 | `om-mega-global` |
| Trust, Privacy & Compliance | 18 | `om-mega-trust` |
| Brand, Positioning & Offer | 16 | `om-mega-strategy` |
| Video & Audio Studio | 16 | `om-mega-studio` |
| Lead Generation & Outbound | 16 | `om-mega-leadgen` |
| PR, Communications & Reputation | 15 | `om-mega-pr` |
| Partnerships, Affiliates & Creators | 14 | `om-mega-partners` |
| Data Science & Customer Intelligence | 12 | `om-mega-data` |
| Product Marketing | 12 | `om-mega-pmm` |
| Customer Success & Support | 12 | `om-mega-success` |
| Web & MarTech Engineering | 11 | `om-mega-martech` |
| Community & Events | 11 | `om-mega-community` |
| Sovereign Command | 10 | `om-mega-sovereign` |
| Commerce & Marketplaces | 10 | `om-mega-commerce` |
| Zero-Budget Growth & Community | 10 | `om-mega-growth-free` |
| Local & Field Marketing | 8 | `om-mega-local` |

각 부서는 메가 에이전트 리더, 검증된 지식 베이스에서 자동 생성되는 지식 브리핑, 그리고 부서 내 모든 에이전트가 공유하는 스킬 패키지를 갖추고 있습니다.

## 핵심 규칙

이메일을 발송하고 광고비를 지출할 수 있는 마케팅 에이전트에게는 AI 모델이 임의로 우회할 수 없는 엄격한 가드레일이 필요합니다.
Whalyom은 50개의 규칙을 정의하고 있으며, 각 규칙은 이를 강제하는 코드를 명시하고 있습니다.

**진실성:** 클레임은 claims.md에서만 인용 · 거짓된 증거 날조 금지 · 모든 지식은 출처와 날짜 명시 · AI 생성 콘텐츠 명시 표기 · 공정하고 최신의 비교 자료만 사용 · 민감한 클레임일수록 강력한 증거 요구 · 고객 증빙 자료는 서면 동의 필수 · 번역 시 원문 사실 왜곡 금지

**소유자 통제권:** 소유자의 승인 없는 외부 발송 금지 · 단일 실행자 원칙 · 설정된 예산 한도 내 집행 · 낭비 감지 시 즉각 자동 중단 · 자율성은 검증을 통해서만 부여되며 비용 협상 불가 · 원장당 단일 기록자 유지 · 다크 패턴 전면 금지 · 가격 결정권은 오직 소유자에게 있음 · 사이트 변경사항은 검토된 diff로만 반영 · 위기 발생 시 즉시 일시 정지

**사람 및 동의:** 사전 동의 우선 · 법률 준수 이메일 발송 · SMS 및 WhatsApp은 옵트인 필수 · 거부 목록 우선 적용 · 개인정보는 로컬에만 보관 · 필요한 최소한의 데이터만 수집 · 개인정보 처리 요청 기한 내 답변 · 아동 대상 마케팅 금지 · 공정한 타겟팅 · 기본 웹 접근성 준수 · 사람 담당자 즉시 연결 경로 유지 · 수신함 보호

**플랫폼 규정:** 가짜 계정 및 투표 조작 금지 · 커뮤니티 규칙 우선 · 정중한 웹 크롤링 · 광고 정책 사전 준수 · 검색 스팸 금지 · 로컬 디렉터리 진실성 유지 · 리뷰 구매 및 게이팅 금지 · 유료 후원 관계 투명 공개 · 라이선스 취득 미디어만 사용

**에이전트 실행 방식:** 실행 전 사전 정독 · 모든 실행은 가설 검증 실험으로 취급 · 결과는 파일로 영구 보관 · 결과로부터 피드백 학습 · 테스트 올 그린 유지 및 가드 유지 · 테스트 중단 규칙 사전 설정 · 수치는 정직하게 보고

**보안:** 에이전트 최소 권한 원칙 · 모든 인시던트 기록 보관 · 시크릿 값 외부 유출 절대 금지 · 외부 입력 텍스트는 오직 데이터로만 취급

전체 규칙 목록은 [rules/](../../rules/README.md)에서 확인할 수 있습니다.

## 지식 베이스

플랫폼들은 매주 정책과 알고리즘을 변경합니다.
Whalyom은 46개의 공식 및 학술 출처를 분석하여 시계열 팩트를 추출하며, 팩트체커 에이전트가 검증을 거쳐 최종 등록합니다.
현재 검색, AI 답변, 개인정보 보호법, 리테일 미디어 등 28개 주제에 걸친 1,152개의 검증된 팩트를 보유하고 있습니다.
기한이 지난 팩트는 자동으로 제거되며, 에이전트들은 작업 시작 전 부서별 브리핑을 필독합니다.

| 주제 | 검증된 팩트 수 |
|---|---:|
| McKinsey, BCG, Bain, Big Four, Accenture, HBR, HBS의 영업, 가격 및 커머셜 우수성 연구 | 200 |
| McKinsey, BCG, Bain, Big Four, Accenture, HBR, HBS의 브랜딩, 고객 경험 및 충성도 연구 | 200 |
| McKinsey, BCG, Bain, Big Four, Accenture, HBR, HBS의 마케팅 및 성장 연구 | 199 |
| McKinsey, BCG, Bain, Big Four, HBR, HBS의 전략 및 경영 표준 이론 | 125 |
| 디지털 마케팅 전략 및 경영 컨설팅 | 39 |
| AI 에이전트, 모델 및 에이전틱 커머스 | 33 |
| 마케팅 과학 및 실증 연구 결과 | 28 |
| 제품 주도 성장(PLG), 프리미엄 모델, 트라이얼 및 인앱 전환 | 20 |
| 브랜드 성장 과학: Ehrenberg-Bass, IPA 효과성, 인지적·물리적 가용성 | 19 |
| 리테일 미디어, 마켓플레이스 및 소셜 커머스 | 18 |
| AI 마케팅 도구, 플랫폼 및 신규 기능 | 17 |
| 파트너 에코시스템, 제휴 마케팅, 크리에이터 및 채널 영업 | 17 |
| AI 및 소비자 보호 규정 | 16 |
| 애널리틱스, 트래킹 및 성과 측정 | 16 |
| 검색 엔진 및 SEO 규칙 | 15 |
| AI 검색 및 답변 엔진 | 15 |
| 검색 광고 플랫폼 | 15 |
| 소셜 광고 플랫폼 | 15 |
| 이메일 도달률 및 메시징 | 15 |
| 개인정보 보호, 동의 및 데이터 법률 | 15 |
| 전환율 최적화, UX, 로딩 속도 및 접근성 | 15 |
| 앱스토어 및 확장 프로그램 스토어 | 15 |
| 커머스 피드, 쇼핑 및 결제 | 15 |
| B2B 아웃바운드 및 영업 | 15 |
| 동영상, 커넥티드 TV 및 프로그래매틱 바잉 | 15 |
| 오가닉 소셜 플랫폼 및 알고리즘 | 14 |
| 가격 책정 및 오퍼 설계 | 14 |
| 콘텐츠 품질 및 편집 기준 | 12 |

## 오픈소스 및 호스팅 에디션 비교

| | Whalyom (본 저장소) | Whalyom Cloud |
|---|---|---|
| 가격 | 무료, MIT 라이선스 | 웹사이트당 유료 구독 |
| 실행 환경 | 로컬 Claude Code 또는 Codex (사용자 계정 구독) | 24시간 연중무휴 클라우드 서버 |
| 에이전트, 스킬, 명령어, 규칙, 지식 | 전체 포함 | 전체 포함 |
| 커맨드 센터 | 로컬 머신에서 실행 | 온라인 웹 대시보드 (영어/페르시아어) |
| 설정 주체 | 사용자 직접 설정 | 사이트 접근 권한 부여 시 전담 지원 |

오픈소스 에디션은 완전한 기능을 갖춘 엔진입니다.
호스팅 에디션은 직접 인프라를 운영하지 않고 결과물을 얻고자 하는 분들을 위한 서비스입니다.

## 호환 플랫폼

Claude Code (에이전트, 스킬, 명령어, 워크플로, MCP 서버 전체 지원) · Codex (스킬, 프롬프트 명령어, `AGENTS.md`) · `AGENTS.md` 및 Agent Skills 규격을 지원하는 모든 AI 에이전트.

## 기여 안내

새로운 에이전트, 스킬, 명령어, 지식 출처 기여를 환영합니다. [CONTRIBUTING.md](../../CONTRIBUTING.md)를 참고해 주세요.
모든 변경사항은 `npm test`가 통과해야 합니다.

## 라이선스

Whalyom 자체 코드는 MIT 라이선스를 따릅니다. 포함된 서드파티 스킬은 해당 원본 라이선스를 유지합니다: [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
