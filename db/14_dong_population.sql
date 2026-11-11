-- 분석 화면의 매출-환경 상관분석용: 행정동 단위 일별 생활인구(서울 열린데이터광장 Open API,
-- Spop250mLocalResdDong, [내국인] 행정동별 서울 생활인구). 약국 소재 행정동(천호1동, 11740600)만 저장한다.
-- 원본은 시간대별(24건/일)이지만 상관분석에는 일별 지표면 충분해 평균/영업시간평균/최소/최대로 요약해 저장한다.
-- environmental_data(날씨)와 같은 용도의 조회 전용 테이블이라 같은 읽기 정책을 따른다.

create table public.dong_population_daily (
  dong_code text not null,
  measured_on date not null,
  avg_population numeric not null,
  business_hours_avg numeric not null, -- 09~20시 평균(영업시간대)
  min_population numeric not null,
  max_population numeric not null,
  primary key (dong_code, measured_on)
);

alter table public.dong_population_daily enable row level security;
create policy dong_population_daily_staff_read on public.dong_population_daily for select using (public.is_staff());
