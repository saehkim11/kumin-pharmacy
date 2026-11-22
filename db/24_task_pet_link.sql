-- 알림 1단계: 공유 업무(예약·일정)에 반려동물을 연결한다. 실행 순서: 01~23 다음에 실행.
-- 열 하나와 인덱스 하나만 추가한다. 기존 열·정책·함수는 바꾸지 않는다.
--  - 기존 업무는 모두 null(연결 없음)이라 영향이 없다.
--  - 읽기·등록 권한은 기존 action_tasks 정책을 그대로 따른다(등록은 관리자, 읽기는 직원 이상).
--  - 수정 가능한 열 목록(title, description, status, priority, due_date)은 그대로라서 pet_id는 등록할 때만 정할 수 있다.
--  - 반려동물이 삭제되면 업무는 남고 연결만 비워진다(on delete set null).
alter table public.action_tasks
  add column pet_id bigint references public.pets (id) on delete set null;

create index on public.action_tasks (pet_id);
