-- 공유 업무를 예약(방문 시간이 있는 일정)으로도 쓸 수 있게 선택적 시간 필드를 추가한다.
-- 시간이 있으면 "오늘 예약"으로 대시보드에 노출하고, 없으면 평소처럼 할 일로 취급한다.
-- 기존 행은 전부 null이라 영향 없음. RLS는 기존 action_tasks 정책을 그대로 따른다(컬럼 추가만).
alter table public.action_tasks add column scheduled_time time;
