-- 접종관리 원본에는 모든 행에 날짜가 있었는데, 가져오기 스크립트(import_pet_visits.py)가
-- "견주 또는 동물이름이 비어있는 행"을 통째로 건너뛰어서 18건의 방문 기록이 날짜 없이
-- pets.notes에만 남아있었다. tools/fix_pet_visits_missing_dates.py로 재구성해 이미 실행 완료.
-- (기록용 — 이미 Supabase에 직접 적용했음, 재실행 불필요)
insert into public.pet_visits (pet_id, visit_date, record, detail) values (10, '2024-04-01', '케니플루', null);
insert into public.pet_visits (pet_id, visit_date, record, detail) values (20, '2024-04-03', '종', null);
insert into public.pet_visits (pet_id, visit_date, record, detail) values (24, '2024-04-08', '프론.스킨샴', null);
insert into public.pet_visits (pet_id, visit_date, record, detail) values (42, '2024-04-26', null, '독하이포모더레이트칼로리');
insert into public.pet_visits (pet_id, visit_date, record, detail) values (44, '2024-04-26', '래비신', null);
insert into public.pet_visits (pet_id, visit_date, record, detail) values (54, '2024-05-04', null, '하이포모더레이트 1키로');
insert into public.pet_visits (pet_id, visit_date, record, detail) values (58, '2024-05-17', '버아트랄 터우린 아목사게루삼', null);
insert into public.pet_visits (pet_id, visit_date, record, detail) values (71, '2024-06-01', '귀', null);
insert into public.pet_visits (pet_id, visit_date, record, detail) values (75, '2024-06-04', '오메가3 스킨벳  입주위피부병', '-----------------------------------');
insert into public.pet_visits (pet_id, visit_date, record, detail) values (181, '2025-01-16', '베트메딘 1/2박스', null);
insert into public.pet_visits (pet_id, visit_date, record, detail) values (278, '2025-06-13', '생리0.45 20개 주문', null);
insert into public.pet_visits (pet_id, visit_date, record, detail) values (303, '2025-08-07', '눈물흐름 트로나옵티쉴드 각1', null);
insert into public.pet_visits (pet_id, visit_date, record, detail) values (331, '2025-10-01', '종코켄 접종 2주후 광인프 넥스2', null);
insert into public.pet_visits (pet_id, visit_date, record, detail) values (466, '2026-04-23', '레날어드1레나메진1', null);
insert into public.pet_visits (pet_id, visit_date, record, detail) values (536, '2026-06-20', '종합1차', null);
insert into public.pet_visits (pet_id, visit_date, record, detail) values (568, '2026-08-03', '레날어드벤스1', null);
insert into public.pet_visits (pet_id, visit_date, record, detail) values (570, '2026-08-06', '베트메딤톨비스토르셈레포틸가리유니', '2.5달에 한번');
insert into public.pet_visits (pet_id, visit_date, record, detail) values (582, '2026-08-18', '아미나2개선입금', null);
