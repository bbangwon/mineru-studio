import unittest
import json
from backend.app.services.hierarchical_chunker import HierarchicalChunker


class TestHierarchicalChunker(unittest.TestCase):

    def test_estimate_korean_tokens(self):
        text = "제1항 이 규칙은 회사의 모든 정규직 및 계약직 근로자에게 적용한다."
        tokens = HierarchicalChunker.estimate_korean_tokens(text)
        # len(text) == 42 -> 21, len(split) == 9 -> 9 * 2.2 = 19 -> max is 21
        self.assertEqual(tokens, max(int(len(text) / 2.0), int(len(text.split()) * 2.2)))
        self.assertEqual(HierarchicalChunker.estimate_korean_tokens(""), 0)

    def test_split_text_into_units_legal(self):
        legal_text = (
            "제3조(적용범위) ① 이 규칙은 모든 근로자에게 적용한다.\n"
            "1. 제1호 사유\n"
            "2. 제2호 사유: 3.14% 이상의 인상률을 적용한다.\n"
            "② 수습기간 중인 자에 대하여는 별도 규정을 준용한다."
        )
        units = HierarchicalChunker.split_text_into_units(legal_text, is_legal=True, max_tokens=512)
        
        # Verify that 3.14% was not split
        self.assertTrue(any("3.14%" in u for u in units))
        # Verify that "적용한다." was not split on "다."
        self.assertFalse(any(u == "다." for u in units))
        # Verify that clause ② is separated
        self.assertTrue(any("②" in u for u in units))
        # Verify that clause ① is present
        self.assertTrue(any("①" in u for u in units))

    def test_split_text_into_units_general(self):
        gen_text = (
            "첫 번째 문장입니다. 석면폐증은 폐에 발생하는 질환이다.\n\n"
            "두 번째 단락의 문장입니다! 세 번째 문장인가요? 그렇습니다."
        )
        units = HierarchicalChunker.split_text_into_units(gen_text, is_legal=False, max_tokens=512)
        self.assertGreaterEqual(len(units), 3)

    def test_force_split_large_sentence(self):
        # Create a single sentence exceeding 512 tokens
        long_sent = "이것은 매우 긴 문장이며, " * 100 + "최종적으로 종결된다."
        units = HierarchicalChunker.split_text_into_units(long_sent, max_tokens=100)
        self.assertGreater(len(units), 1)
        for u in units:
            self.assertLessEqual(HierarchicalChunker.estimate_korean_tokens(u), 105)

    def test_table_search_text_generation(self):
        raw_html = (
            "<table>"
            "<tr><th>구분</th><th>지급액</th><th>비고</th></tr>"
            "<tr><td>기본급</td><td>3,000,000</td><td>정기지급</td></tr>"
            "<tr><td>상여금</td><td>1,000,000</td><td>성과연동</td></tr>"
            "</table>"
        )
        search_text = HierarchicalChunker.generate_table_search_text(
            raw_html=raw_html,
            caption="급여 지급 기준표",
            footnote="세전 기준 금액임"
        )
        self.assertIn("[표: 급여 지급 기준표]", search_text)
        self.assertIn("구분", search_text)
        self.assertIn("지급액", search_text)
        self.assertIn("기본급", search_text)
        self.assertIn("(주: 세전 기준 금액임)", search_text)

    def test_legal_chunking_hierarchy(self):
        chunker = HierarchicalChunker(doc_id="test_legal_doc")
        sample_content_list = [
            {
                "type": "text",
                "text": "제1장 총칙",
                "text_level": 1,
                "page_idx": 0,
            },
            {
                "type": "text",
                "text": "제1조(목적) ① 이 규칙은 근로자의 기본적 생활을 보장함을 목적으로 한다. ② 근로조건은 근로자와 사용자가 동등한 지위에서 자유의사로 결정한다.",
                "page_idx": 0,
            },
            {
                "type": "table",
                "table_body": "<table><tr><th>등급</th><th>기준</th></tr><tr><td>1급</td><td>중증</td></tr></table>",
                "table_caption": "장해등급표",
                "page_idx": 1,
            },
            {
                "type": "text",
                "text": "제2조(정의) 이 규칙에서 사용하는 용어의 뜻은 다음과 같다.\n1. 근로자란 직업의 종류와 관계없이 임금을 목적으로 사업이나 사업장에 근로를 제공하는 사람을 말한다.",
                "page_idx": 1,
            }
        ]

        etl_res = chunker.chunk_content_list(sample_content_list, doc_title="취업규칙", strategy="legal")

        self.assertEqual(etl_res["strategy"], "legal")
        self.assertIn("sections", etl_res)
        self.assertIn("parent_chunks", etl_res)
        self.assertIn("child_chunks", etl_res)

        sections = etl_res["sections"]
        parents = etl_res["parent_chunks"]
        children = etl_res["child_chunks"]

        self.assertGreaterEqual(len(sections), 1)
        self.assertGreaterEqual(len(parents), 2)
        self.assertGreaterEqual(len(children), 3)

        # Verify bidirectional links:
        for p in parents:
            # Each parent must have a valid section_id in sections
            self.assertTrue(any(s["id"] == p["section_id"] for s in sections))
            # Each parent's child_chunk_ids must exist in children
            for cid in p["child_chunk_ids"]:
                self.assertTrue(any(c["chunk_id"] == cid for c in children))

        for c in children:
            # Each child must point to a valid parent_chunk_id
            self.assertTrue(any(p["parent_chunk_id"] == c["parent_chunk_id"] for p in parents))
            self.assertEqual(c["parent_id"], c["parent_chunk_id"])
            # Each child must point to a valid section_id
            self.assertTrue(any(s["id"] == c["section_id"] for s in sections))

        # Check atomic table
        table_child = next(c for c in children if c["chunk_type"] == "table")
        self.assertTrue(table_child["is_atomic_table"])
        self.assertTrue(table_child["is_table"])
        self.assertIn("장해등급표", table_child["text"])
        self.assertIn("<table>", table_child["raw_html"])

    def test_general_chunking_hierarchy(self):
        chunker = HierarchicalChunker(doc_id="test_gen_doc")
        sample_content_list = [
            {
                "type": "title",
                "content": {"title_content": [{"type": "text", "content": "1. 서론"}], "level": 1},
                "page_idx": 0
            },
            {
                "type": "paragraph",
                "content": {"paragraph_content": [{"type": "text", "content": "본 연구는 석면 질환의 위험성을 평가한다. 연구 방법은 통계 분석을 따른다."}]},
                "page_idx": 0
            },
            {
                "type": "title",
                "content": {"title_content": [{"type": "text", "content": "1.1 분석 방법론"}], "level": 3},
                "page_idx": 1
            },
            {
                "type": "paragraph",
                "content": {"paragraph_content": [{"type": "text", "content": "분석 방법론에 대한 상세 내용입니다."}]},
                "page_idx": 1
            }
        ]

        etl_res = chunker.chunk_content_list(sample_content_list, doc_title="석면연구보고서", strategy="general")
        self.assertIn("sections", etl_res)
        self.assertIn("parent_chunks", etl_res)
        self.assertIn("child_chunks", etl_res)
        self.assertGreaterEqual(len(etl_res["sections"]), 1)
        self.assertGreaterEqual(len(etl_res["parent_chunks"]), 1)
        self.assertGreaterEqual(len(etl_res["child_chunks"]), 2)

    def test_reindex_etl_result(self):
        chunker = HierarchicalChunker(doc_id="reindex_test")
        sample_content_list = [
            {"type": "text", "text": "제1장 총칙", "text_level": 1, "page_idx": 0},
            {"type": "text", "text": "제1조(목적) ① 목적 내용입니다.", "page_idx": 0},
            {"type": "text", "text": "제2조(적용) ① 적용 내용입니다.", "page_idx": 1},
        ]
        etl_res = chunker.chunk_content_list(sample_content_list, strategy="legal")

        # Mutate IDs to simulate manual edit desynchronization
        etl_res["child_chunks"][0]["chunk_id"] = "custom_c999"
        etl_res["parent_chunks"][0]["child_chunk_ids"][0] = "custom_c999"

        reindexed = HierarchicalChunker.reindex_etl_result(etl_res)

        # Check that IDs are sequential
        self.assertEqual(reindexed["sections"][0]["id"], f"{reindexed['doc_id']}_s00")
        self.assertEqual(reindexed["parent_chunks"][0]["parent_chunk_id"], f"{reindexed['doc_id']}_p0001")
        self.assertEqual(reindexed["child_chunks"][0]["chunk_id"], f"{reindexed['doc_id']}_c0001")

        # Check that cross references are correctly remapped
        first_child = reindexed["child_chunks"][0]
        first_parent = reindexed["parent_chunks"][0]
        self.assertEqual(first_child["parent_chunk_id"], first_parent["parent_chunk_id"])
        self.assertIn(first_child["chunk_id"], first_parent["child_chunk_ids"])

    def test_export_to_jsonl(self):
        chunker = HierarchicalChunker(doc_id="jsonl_test")
        sample_content_list = [
            {"type": "text", "text": "제1장 총칙", "text_level": 1, "page_idx": 0},
            {"type": "text", "text": "제1조(목적) ① 이 규칙은 사원의 복지를 증진함을 목적으로 한다. ② 근로조건을 명확히 규정한다.", "page_idx": 0},
        ]
        etl_res = chunker.chunk_content_list(sample_content_list, doc_title="사규", strategy="legal")
        jsonl_str = chunker.export_to_jsonl(etl_res)

        lines = [line.strip() for line in jsonl_str.split("\n") if line.strip()]
        self.assertGreaterEqual(len(lines), 1)

        for line in lines:
            record = json.loads(line)
            # Verify Small-to-Big Retrieval required fields:
            self.assertIn("id", record)
            self.assertIn("parent_chunk_id", record)
            self.assertIn("section_id", record)
            self.assertIn("section_title", record)
            self.assertIn("breadcrumbs", record)
            self.assertIn("breadcrumbs_str", record)
            self.assertIn("text", record)
            self.assertIn("parent_context_text", record)
            self.assertIn("token_estimate", record)
            self.assertIn("parent_token_estimate", record)
            self.assertIn("is_atomic_table", record)
            self.assertIn("metadata", record)
            self.assertEqual(record["metadata"]["doc_title"], "사규")

    def test_huge_table_promoted_to_parent(self):
        # Create a table exceeding 2048 tokens
        large_rows = "".join(f"<tr><td>항목{i}</td><td>상세설명내용_{i}_데이터테스트</td><td>비고{i}</td></tr>" for i in range(250))
        huge_html = f"<table><thead><tr><th>항목</th><th>내용</th><th>비고</th></tr></thead><tbody>{large_rows}</tbody></table>"
        self.assertGreater(HierarchicalChunker.estimate_korean_tokens(huge_html), 2048)

        sample_content_list = [
            {"type": "text", "text": "제1장 총칙", "text_level": 1, "page_idx": 0},
            {"type": "text", "text": "제1조(목적) 서두 설명 문단입니다.", "page_idx": 0},
            {"type": "table", "table_body": huge_html, "table_caption": "초대형기준표", "page_idx": 0},
            {"type": "text", "text": "제2조(후속) 후속 설명 문단입니다.", "page_idx": 0},
        ]
        chunker = HierarchicalChunker(doc_id="huge_table_doc")
        etl_res = chunker.chunk_content_list(sample_content_list, strategy="legal")

        # Table child should exist and be atomic
        table_child = next(c for c in etl_res["child_chunks"] if c["chunk_type"] == "table")
        self.assertTrue(table_child["is_atomic_table"])

        # Table parent should be standalone (containing only the table child)
        table_parent = next(p for p in etl_res["parent_chunks"] if table_child["chunk_id"] in p["child_chunk_ids"])
        self.assertEqual(len(table_parent["child_chunk_ids"]), 1)
        self.assertIn(table_child["chunk_id"], table_parent["child_chunk_ids"])

    def test_reindex_preserves_physical_order(self):
        chunker = HierarchicalChunker(doc_id="order_test")
        # Simulating out-of-order children resulting from UI edits
        etl_res = {
            "doc_id": "test_doc",
            "doc_title": "테스트",
            "strategy": "legal",
            "sections": [
                {"id": "d_1234_s00", "title": "루트", "level": 0, "parent_chunk_ids": [], "child_chunk_ids": [], "page_range": [1, 1]},
                {"id": "d_1234_s02", "title": "2장", "level": 1, "parent_chunk_ids": ["d_1234_p02"], "child_chunk_ids": ["d_1234_c02"], "page_range": [5, 6]},
                {"id": "d_1234_s01", "title": "1장", "level": 1, "parent_chunk_ids": ["d_1234_p01"], "child_chunk_ids": ["d_1234_c01"], "page_range": [2, 3]},
            ],
            "parent_chunks": [
                {"parent_chunk_id": "d_1234_p02", "id": "d_1234_p02", "section_id": "d_1234_s02", "title": "2장 P", "text": "P2 text", "token_estimate": 20, "child_chunk_ids": ["d_1234_c02"], "page_range": [5, 6]},
                {"parent_chunk_id": "d_1234_p01", "id": "d_1234_p01", "section_id": "d_1234_s01", "title": "1장 P", "text": "P1 text", "token_estimate": 20, "child_chunk_ids": ["d_1234_c01"], "page_range": [2, 3]},
            ],
            "child_chunks": [
                {"chunk_id": "d_1234_c02", "parent_chunk_id": "d_1234_p02", "parent_id": "d_1234_p02", "section_id": "d_1234_s02", "chunk_type": "paragraph", "text": "Page 5 text", "token_estimate": 10, "page_number": 5, "breadcrumbs": []},
                {"chunk_id": "d_1234_c01", "parent_chunk_id": "d_1234_p01", "parent_id": "d_1234_p01", "section_id": "d_1234_s01", "chunk_type": "paragraph", "text": "Page 2 text", "token_estimate": 10, "page_number": 2, "breadcrumbs": []},
            ]
        }

        reindexed = HierarchicalChunker.reindex_etl_result(etl_res)

        # After reindexing, items should be sorted by physical page order:
        # Section on page 2 (1장) should come before Section on page 5 (2장)
        self.assertEqual(reindexed["sections"][1]["title"], "1장")
        self.assertEqual(reindexed["sections"][2]["title"], "2장")

        # Child on page 2 should become c0001
        self.assertEqual(reindexed["child_chunks"][0]["page_number"], 2)
        self.assertEqual(reindexed["child_chunks"][0]["chunk_id"], f"{reindexed['doc_id']}_c0001")
        self.assertEqual(reindexed["child_chunks"][1]["page_number"], 5)
        self.assertEqual(reindexed["child_chunks"][1]["chunk_id"], f"{reindexed['doc_id']}_c0002")

    def test_e2e_full_lifecycle_flow(self):
        """
        Phase 3 E2E 테스트:
        3단계 청킹 생성 -> 수동 분할 -> 수동 병합 & Auto-prune -> 상위 섹션 재지정 (Cascading Sync) -> Re-index -> JSONL 내보내기
        """
        chunker = HierarchicalChunker(doc_id="e2e_doc")
        sample_content = [
            {"type": "text", "text": "제1장 총칙", "text_level": 1, "page_idx": 0},
            {"type": "text", "text": "제1조(목적) ① 본 규칙은 근로자의 권익을 보호하고 회사의 건전한 발전을 목적으로 한다.\n② 근로조건은 법정 기준 이상이어야 한다.", "page_idx": 0},
            {"type": "table", "table_body": "<table><tr><th>직급</th><th>기본급</th></tr><tr><td>사원</td><td>250만원</td></tr></table>", "table_caption": "기본급표", "page_idx": 0},
            {"type": "text", "text": "제2장 복무", "text_level": 1, "page_idx": 1},
            {"type": "text", "text": "제2조(성실의무) ① 근로자는 직무를 성실히 수행해야 한다.", "page_idx": 1},
        ]

        # 1. 3단계 청킹 생성
        etl_res = chunker.chunk_content_list(sample_content, doc_title="취업규칙", strategy="legal")
        # sections includes root doc section (level 0) + 제1장 (level 1) + 제2장 (level 1) -> 3 sections
        self.assertEqual(len(etl_res["sections"]), 3)
        self.assertGreaterEqual(len(etl_res["parent_chunks"]), 2)
        self.assertGreaterEqual(len(etl_res["child_chunks"]), 3)

        # 표 원자성 검증
        table_chunk = next(c for c in etl_res["child_chunks"] if c["chunk_type"] == "table")
        self.assertTrue(table_chunk["is_atomic_table"])
        self.assertIn("기본급표", table_chunk["text"])
        self.assertIn("<table>", table_chunk["raw_html"])

        # 2. Split Chunk 시뮬레이션: 첫 번째 Child 분할
        c0 = etl_res["child_chunks"][0]
        p0_id = c0["parent_chunk_id"]
        c0_split_1 = {**c0, "chunk_id": f"{c0['chunk_id']}_1", "text": "제1조(목적) ① 본 규칙은 근로자의 권익을 보호하고"}
        c0_split_2 = {**c0, "chunk_id": f"{c0['chunk_id']}_2", "text": "회사의 건전한 발전을 목적으로 한다."}
        etl_res["child_chunks"] = [c0_split_1, c0_split_2] + etl_res["child_chunks"][1:]

        # 상위 Parent의 child_chunk_ids 갱신
        p0 = next(p for p in etl_res["parent_chunks"] if (p["parent_chunk_id"] == p0_id or p.get("id") == p0_id))
        p0["child_chunk_ids"] = [c0_split_1["chunk_id"], c0_split_2["chunk_id"]] + [cid for cid in p0["child_chunk_ids"] if cid != c0["chunk_id"]]

        self.assertIn(c0_split_1["chunk_id"], p0["child_chunk_ids"])
        self.assertIn(c0_split_2["chunk_id"], p0["child_chunk_ids"])

        # 3. Merge Chunk 시뮬레이션: c0_split_1과 c0_split_2를 다시 병합
        merged_c = {**c0_split_1, "chunk_id": c0["chunk_id"], "text": "제1조(목적) ① 본 규칙은 근로자의 권익을 보호하고 회사의 건전한 발전을 목적으로 한다."}
        etl_res["child_chunks"] = [merged_c] + etl_res["child_chunks"][2:]
        p0["child_chunk_ids"] = [merged_c["chunk_id"]] + [cid for cid in p0["child_chunk_ids"] if cid not in (c0_split_1["chunk_id"], c0_split_2["chunk_id"])]

        # 4. 상위 섹션 재지정 시뮬레이션 (Reassign Parent Section)
        # 제1장의 p0를 제2장 섹션(sec2)으로 이동
        sec1 = etl_res["sections"][1]
        sec2 = etl_res["sections"][2]
        target_pid = p0["parent_chunk_id"]
        new_sec_id = sec2["id"]

        # Parent 변경
        p0["section_id"] = new_sec_id
        # 섹션 링크 갱신
        sec1["parent_chunk_ids"] = [pid for pid in sec1["parent_chunk_ids"] if pid != target_pid]
        sec2["parent_chunk_ids"].append(target_pid)

        # 하위 Child 연쇄 갱신 (Cascading Sync)
        for c in etl_res["child_chunks"]:
            if c["parent_chunk_id"] == target_pid:
                c["section_id"] = new_sec_id
                c["breadcrumbs"] = list(sec2["breadcrumbs"])

        for c in etl_res["child_chunks"]:
            if c["parent_chunk_id"] == target_pid:
                self.assertEqual(c["section_id"], new_sec_id)
                self.assertEqual(c["breadcrumbs"], sec2["breadcrumbs"])

        # 5. Re-index 시뮬레이션
        reindexed = HierarchicalChunker.reindex_etl_result(etl_res)
        self.assertTrue(reindexed["sections"][0]["id"].endswith("_s00"))
        self.assertTrue(reindexed["parent_chunks"][0]["parent_chunk_id"].endswith("_p0001"))
        self.assertTrue(reindexed["child_chunks"][0]["chunk_id"].endswith("_c0001"))

        # 6. JSONL 출력 검증
        jsonl_str = chunker.export_to_jsonl(reindexed)
        lines = [line.strip() for line in jsonl_str.split("\n") if line.strip()]
        self.assertEqual(len(lines), len(reindexed["child_chunks"]))

        for line in lines:
            record = json.loads(line)
            self.assertIn("parent_context_text", record)
            self.assertIn("breadcrumbs_str", record)
            self.assertGreater(len(record["parent_context_text"]), 0)

    def test_normalize_text_for_embedding(self):
        # 1. Hyphenated word across line break
        raw_text = "This is a multi-\nlingual embedding model test."
        norm = HierarchicalChunker.normalize_text_for_embedding(raw_text)
        self.assertEqual(norm, "This is a multilingual embedding model test.")

        # 2. Korean sentence with line breaks and multiple spaces
        korean_raw = "제1조(목적) 이 조례는 청년의\n\n권익증진과  사회참여를\n보장함을 목적으로 한다."
        norm_k = HierarchicalChunker.normalize_text_for_embedding(korean_raw)
        self.assertEqual(norm_k, "제1조(목적) 이 조례는 청년의 권익증진과 사회참여를 보장함을 목적으로 한다.")
        self.assertNotIn("\n", norm_k)

    def test_normalize_parent_text(self):
        parent_raw = (
            "[취업규칙 > 제1장]\n\n"
            "제1조(목적) 이 규칙은 회사의\n업무 능률 향상을 목적으로 한다.\n\n"
            "제2조(정의) 용어의 정의는 다음과 같다.\n"
            "1. 근로자란 임금을 목적으로\n근로를 제공하는 자를 말한다.\n"
            "2. 사용자란 사업주를 말한다."
        )
        norm_p = HierarchicalChunker.normalize_parent_text(parent_raw)
        
        # 문단 간 빈 줄(\n\n) 유지 확인
        self.assertIn("\n\n", norm_p)
        # 문장 중간 임의 개행 제거(공백 치환) 확인
        self.assertIn("회사의 업무 능률 향상", norm_p)
        self.assertIn("임금을 목적으로 근로를 제공하는 자", norm_p)
        # 목록 항목 번호 앞 줄바꿈 유지 확인
        self.assertIn("\n1. 근로자란", norm_p)
        self.assertIn("\n2. 사용자란", norm_p)

    def test_child_chunks_have_no_newlines_in_etl(self):
        sample_content_list = [
            {"type": "text", "text": "제1장 총칙", "text_level": 1, "page_idx": 0},
            {
                "type": "text",
                "text": "제1조(목적) 이 조례는 청년의\n권익증진과 능동적인\n사회참여 기회를 보장함을\n목적으로 한다.",
                "page_idx": 0,
            },
            {
                "type": "table",
                "table_body": "<table><tr><th>등급</th><th>기준</th></tr><tr><td>1급</td><td>중증</td></tr></table>",
                "table_caption": "장해등급표",
                "page_idx": 1,
            },
            {
                "type": "text",
                "text": "제2조(정의) 이 규칙에서 사용하는\n용어의 뜻은 다음과 같다.\n1. 청년이란 19세 이상\n34세 이하인 사람을 말한다.",
                "page_idx": 1,
            }
        ]
        chunker = HierarchicalChunker(doc_id="newline_test_doc")
        etl_res = chunker.chunk_content_list(sample_content_list, doc_title="조례집", strategy="legal")

        # 모든 Child Chunk에 줄바꿈이 전혀 없어야 함!
        self.assertGreater(len(etl_res["child_chunks"]), 0)
        for child in etl_res["child_chunks"]:
            self.assertNotIn("\n", child["text"], f"Child chunk {child['chunk_id']} contains newline: {child['text']}")
            self.assertNotIn("\r", child["text"])

        # Parent Chunk에는 문단/목록 구조적 개행(\n\n 또는 \n)이 존재해야 함!
        self.assertGreater(len(etl_res["parent_chunks"]), 0)
        for parent in etl_res["parent_chunks"]:
            self.assertIn("\n", parent["text"], f"Parent chunk {parent['parent_chunk_id']} should maintain structural newlines")

    def test_multi_page_child_chunk_range(self):
        # 3페이지(page_idx=2)부터 5페이지(page_idx=4)까지 짧은 텍스트가 연속으로 들어와 하나의 청크로 합쳐지는 시나리오
        sample_content_list = [
            {"type": "text", "text": "제1장 총칙", "text_level": 1, "page_idx": 2},
            {"type": "text", "text": "3페이지의 첫 번째 문장입니다.", "page_idx": 2},
            {"type": "text", "text": "4페이지의 두 번째 문장입니다.", "page_idx": 3},
            {"type": "text", "text": "5페이지의 세 번째 문장입니다.", "page_idx": 4},
        ]
        chunker = HierarchicalChunker(doc_id="multipage_doc")
        etl_res = chunker.chunk_content_list(sample_content_list, doc_title="다중페이지테스트", strategy="general")

        child_chunks = etl_res["child_chunks"]
        self.assertEqual(len(child_chunks), 1)
        chunk = child_chunks[0]

        # 0-indexed page_idx: 2 -> 3페이지, 4 -> 5페이지
        self.assertEqual(chunk["page_number"], 3)
        self.assertEqual(chunk["page_end"], 5)
        self.assertEqual(chunk["metadata"]["page"], 3)
        self.assertEqual(chunk["metadata"]["page_start"], 3)
        self.assertEqual(chunk["metadata"]["page_end"], 5)
        self.assertEqual(chunk["metadata"]["pages"], [3, 4, 5])

    def test_multi_page_child_chunk_range_legal(self):
        # 법률 문서에서 조항이 3페이지부터 5페이지까지 걸쳐 있는 시나리오
        sample_content_list = [
            {"type": "text", "text": "제1장 총칙", "text_level": 1, "page_idx": 2},
            {"type": "text", "text": "제1조(목적) ① 3페이지의 제1항 내용입니다.", "page_idx": 2},
            {"type": "text", "text": "② 4페이지의 제2항 내용입니다.", "page_idx": 3},
            {"type": "text", "text": "③ 5페이지의 제3항 내용입니다.", "page_idx": 4},
        ]
        chunker = HierarchicalChunker(doc_id="multipage_legal_doc")
        etl_res = chunker.chunk_content_list(sample_content_list, doc_title="법률다중페이지테스트", strategy="legal")

        child_chunks = etl_res["child_chunks"]
        self.assertEqual(len(child_chunks), 1)
        chunk = child_chunks[0]

        self.assertEqual(chunk["page_number"], 3)
        self.assertEqual(chunk["page_end"], 5)
        self.assertEqual(chunk["metadata"]["page"], 3)
        self.assertEqual(chunk["metadata"]["page_start"], 3)
        self.assertEqual(chunk["metadata"]["page_end"], 5)
        self.assertEqual(chunk["metadata"]["pages"], [3, 4, 5])


    def test_reindex_preserves_parent_reordering(self):
        """
        동일 섹션/동일 페이지 내에서 사용자가 Parent 청크의 순서를 수동으로 변경(Move Up/Down)한 경우,
        Re-index 후에도 사용자가 의도한 순서가 유지되는지 검증합니다.
        """
        etl_res = {
            "doc_id": "reorder_doc",
            "doc_title": "순서변경테스트",
            "strategy": "legal",
            "sections": [
                {
                    "id": "d_1111_s01",
                    "title": "제1장",
                    "level": 1,
                    # p02가 p01보다 앞으로 순서 변경됨
                    "parent_chunk_ids": ["d_1111_p02", "d_1111_p01"],
                    "child_chunk_ids": ["d_1111_c02", "d_1111_c01"],
                    "page_range": [2, 2],
                }
            ],
            "parent_chunks": [
                {
                    "parent_chunk_id": "d_1111_p02",
                    "id": "d_1111_p02",
                    "section_id": "d_1111_s01",
                    "title": "제2조",
                    "text": "제2조 내용",
                    "token_estimate": 15,
                    "child_chunk_ids": ["d_1111_c02"],
                    "page_range": [2, 2],
                },
                {
                    "parent_chunk_id": "d_1111_p01",
                    "id": "d_1111_p01",
                    "section_id": "d_1111_s01",
                    "title": "제1조",
                    "text": "제1조 내용",
                    "token_estimate": 15,
                    "child_chunk_ids": ["d_1111_c01"],
                    "page_range": [2, 2],
                },
            ],
            "child_chunks": [
                {
                    "chunk_id": "d_1111_c02",
                    "parent_chunk_id": "d_1111_p02",
                    "parent_id": "d_1111_p02",
                    "section_id": "d_1111_s01",
                    "chunk_type": "paragraph",
                    "text": "제2조 내용입니다.",
                    "page_number": 2,
                    "breadcrumbs": [],
                },
                {
                    "chunk_id": "d_1111_c01",
                    "parent_chunk_id": "d_1111_p01",
                    "parent_id": "d_1111_p01",
                    "section_id": "d_1111_s01",
                    "chunk_type": "paragraph",
                    "text": "제1조 내용입니다.",
                    "page_number": 2,
                    "breadcrumbs": [],
                },
            ],
        }

        reindexed = HierarchicalChunker.reindex_etl_result(etl_res)

        # 재색인 후에도 제2조(p02 -> p001)가 제1조(p01 -> p002)보다 앞에 위치해야 함
        self.assertEqual(reindexed["parent_chunks"][0]["title"], "제2조")
        self.assertEqual(reindexed["parent_chunks"][1]["title"], "제1조")
        self.assertEqual(reindexed["child_chunks"][0]["text"], "제2조 내용입니다.")
        self.assertEqual(reindexed["child_chunks"][1]["text"], "제1조 내용입니다.")
        self.assertEqual(reindexed["sections"][0]["parent_chunk_ids"], [
            reindexed["parent_chunks"][0]["parent_chunk_id"],
            reindexed["parent_chunks"][1]["parent_chunk_id"],
        ])

    def test_index_and_list_blocks_preserved(self):
        """MinerU의 index 및 list 블록이 누락되지 않고 청크에 온전히 포함되는지 검증"""
        content_list_v2 = [
            [
                {
                    "type": "paragraph",
                    "content": {
                        "paragraph_content": [{"type": "text", "content": "제38조(업무상질병판정위원회)① 제37조제1항제2호에 따른 업무상 질병의 인정 여부를 심의하기 위하여 공단 소속기관에 업무상질병판정위원회(이하\"판정위원회\"라 한다)를 둔다."}]
                    },
                    "bbox": [52, 138, 931, 174]
                },
                {
                    "type": "index",
                    "content": {
                        "list_type": "text_list",
                        "list_items": [
                            {"item_type": "text", "item_content": [{"type": "text", "content": "2판정위원회의 심의에서 제외되는 질병과 판정위원회의 심의 절차는 고용노동부령으로 정한다.<개정 2010.6."}]},
                            {"item_type": "text", "item_content": [{"type": "text", "content": "4.>"}]}
                        ]
                    },
                    "bbox": [75, 176, 954, 211]
                },
                {
                    "type": "paragraph",
                    "content": {
                        "paragraph_content": [{"type": "text", "content": "3판정위원회의 구성과 운영에 필요한 사항은 고용노동부령으로 정한다.<개정 2010.6.4.>"}]
                    },
                    "bbox": [77, 214, 776, 232]
                }
            ]
        ]

        chunker = HierarchicalChunker(doc_id="test_index_doc")
        res = chunker.chunk_content_list(content_list_v2, doc_title="산업재해보상보험법", strategy="legal")

        # 제38조 2항 텍스트가 child_chunks 중 하나에 포함되어 있어야 함
        all_child_texts = " ".join(c["text"] for c in res["child_chunks"])
        self.assertIn("판정위원회의 심의에서 제외되는 질병", all_child_texts)
        self.assertIn("4.>", all_child_texts)
        self.assertIn("3판정위원회의 구성과 운영", all_child_texts)

        # general 전략에서도 테스트
        res_gen = chunker.chunk_content_list(content_list_v2, doc_title="일반문서", strategy="general")
        all_gen_texts = " ".join(c["text"] for c in res_gen["child_chunks"])
        self.assertIn("판정위원회의 심의에서 제외되는 질병", all_gen_texts)

    def test_reindex_preserves_section_reordering(self):
        """
        동일 페이지 내에서 사용자가 섹션 순서를 수동으로 변경한 경우,
        Re-index 후에도 사용자가 의도한 섹션 순서가 유지되는지 검증합니다.
        """
        etl_res = {
            "doc_id": "sec_reorder_doc",
            "doc_title": "섹션순서변경테스트",
            "strategy": "legal",
            "sections": [
                {
                    "id": "d_2222_s02",
                    "title": "제2장 (앞으로 이동됨)",
                    "level": 1,
                    "parent_chunk_ids": ["d_2222_p02"],
                    "child_chunk_ids": ["d_2222_c02"],
                    "page_range": [2, 2],
                },
                {
                    "id": "d_2222_s01",
                    "title": "제1장 (뒤로 이동됨)",
                    "level": 1,
                    "parent_chunk_ids": ["d_2222_p01"],
                    "child_chunk_ids": ["d_2222_c01"],
                    "page_range": [2, 2],
                },
            ],
            "parent_chunks": [
                {
                    "parent_chunk_id": "d_2222_p02",
                    "id": "d_2222_p02",
                    "section_id": "d_2222_s02",
                    "title": "제2장 부모",
                    "text": "제2장 부모 내용",
                    "token_estimate": 15,
                    "child_chunk_ids": ["d_2222_c02"],
                    "page_range": [2, 2],
                },
                {
                    "parent_chunk_id": "d_2222_p01",
                    "id": "d_2222_p01",
                    "section_id": "d_2222_s01",
                    "title": "제1장 부모",
                    "text": "제1장 부모 내용",
                    "token_estimate": 15,
                    "child_chunk_ids": ["d_2222_c01"],
                    "page_range": [2, 2],
                },
            ],
            "child_chunks": [
                {
                    "chunk_id": "d_2222_c02",
                    "parent_chunk_id": "d_2222_p02",
                    "parent_id": "d_2222_p02",
                    "section_id": "d_2222_s02",
                    "chunk_type": "paragraph",
                    "text": "제2장 자식 내용입니다.",
                    "page_number": 2,
                    "breadcrumbs": [],
                },
                {
                    "chunk_id": "d_2222_c01",
                    "parent_chunk_id": "d_2222_p01",
                    "parent_id": "d_2222_p01",
                    "section_id": "d_2222_s01",
                    "chunk_type": "paragraph",
                    "text": "제1장 자식 내용입니다.",
                    "page_number": 2,
                    "breadcrumbs": [],
                },
            ],
        }

        reindexed = HierarchicalChunker.reindex_etl_result(etl_res)

        # 사용자가 바꾼 순서대로 제2장이 첫 번째 섹션(s01), 제1장이 두 번째 섹션(s02)이 되어야 함
        self.assertEqual(reindexed["sections"][0]["title"], "제2장 (앞으로 이동됨)")
        self.assertEqual(reindexed["sections"][1]["title"], "제1장 (뒤로 이동됨)")
        self.assertEqual(reindexed["sections"][0]["id"], f"{reindexed['doc_id']}_s01")
        self.assertEqual(reindexed["sections"][1]["id"], f"{reindexed['doc_id']}_s02")

    def test_table_chunk_excludes_image_info(self):
        """테이블 청크 및 JSONL 내보내기에서 image_path, image_url, metadata.has_image가 제외되는지 검증"""
        content_list = [
            {
                "type": "table",
                "table_caption": ["테스트 표"],
                "html": "<table><tr><td>내용</td></tr></table>",
                "image_source": {"path": "images/table_001.png"},
                "page_idx": 1,
            }
        ]
        chunker = HierarchicalChunker(doc_id="table_test_doc")
        etl_res = chunker.chunk_content_list(content_list, doc_title="테이블테스트", strategy="general")

        child_chunks = etl_res["child_chunks"]
        self.assertEqual(len(child_chunks), 1)
        tbl_chunk = child_chunks[0]

        # 1. 청크 자체에 image_path, image_url이 없어야 함
        self.assertNotIn("image_path", tbl_chunk)
        self.assertNotIn("image_url", tbl_chunk)

        # 2. metadata에 has_image, image_path, image_url이 없어야 함
        self.assertNotIn("has_image", tbl_chunk["metadata"])
        self.assertNotIn("image_path", tbl_chunk["metadata"])
        self.assertNotIn("image_url", tbl_chunk["metadata"])

        # 3. JSONL 내보내기 시에도 해당 정보가 제외되어야 함
        jsonl_str = chunker.export_to_jsonl(etl_res)
        self.assertNotIn("image_path", jsonl_str)
        self.assertNotIn("image_url", jsonl_str)
        self.assertNotIn("has_image", jsonl_str)

        # 4. Re-index 후에도 제외 상태 유지 검증
        reindexed = HierarchicalChunker.reindex_etl_result(etl_res)
        reindexed_chunk = reindexed["child_chunks"][0]
        self.assertNotIn("image_path", reindexed_chunk)
        self.assertNotIn("image_url", reindexed_chunk)
        self.assertNotIn("has_image", reindexed_chunk.get("metadata", {}))

    def test_recalculate_section_hierarchy(self):
        # 파서가 level=2, level=3 등으로 건너뛰어 태깅한 섹션들 시뮬레이션
        sections = [
            {"id": "doc_s00", "title": "산재 질병 지침", "level": 0},
            {"id": "doc_s01", "title": "I.목적", "level": 2, "parent_section_id": "doc_s00"},
            {"id": "doc_s02", "title": "II.고시 적용기준", "level": 2, "parent_section_id": "doc_s00"},
            {"id": "doc_s03", "title": "1.공통요건", "level": 3, "parent_section_id": "doc_s02"},
            {"id": "doc_s04", "title": "가.경추간판탈출증", "level": 3, "parent_section_id": "doc_s03"},
        ]
        recalculated = HierarchicalChunker.recalculate_section_hierarchy(sections, doc_title="산재 질병 지침")

        # 루트: H0
        self.assertEqual(recalculated[0]["level"], 0)
        self.assertEqual(recalculated[0]["breadcrumbs"], ["산재 질병 지침"])

        # I.목적: 루트 직속 자식이므로 무조건 H1
        self.assertEqual(recalculated[1]["level"], 1)
        self.assertEqual(recalculated[1]["breadcrumbs"], ["산재 질병 지침", "I.목적"])

        # II.고시 적용기준: H1
        self.assertEqual(recalculated[2]["level"], 1)

        # 1.공통요건: II.고시 적용기준의 자식이므로 H2
        self.assertEqual(recalculated[3]["level"], 2)
        self.assertEqual(recalculated[3]["breadcrumbs"], ["산재 질병 지침", "II.고시 적용기준", "1.공통요건"])

        # 가.경추간판탈출증: 1.공통요건의 자식이므로 H3
        self.assertEqual(recalculated[4]["level"], 3)
        self.assertEqual(recalculated[4]["breadcrumbs"], ["산재 질병 지침", "II.고시 적용기준", "1.공통요건", "가.경추간판탈출증"])

    def test_reindex_updates_section_hierarchy(self):
        etl_res = {
            "doc_id": "test_reindex_doc",
            "doc_title": "가이드라인",
            "strategy": "general",
            "sections": [
                {"id": "test_reindex_doc_s00", "title": "가이드라인", "level": 0},
                {"id": "test_reindex_doc_s01", "title": "개요", "level": 2, "parent_section_id": "test_reindex_doc_s00", "page_range": [1, 1], "parent_chunk_ids": ["test_reindex_doc_p001"], "child_chunk_ids": ["test_reindex_doc_c001"]},
                {"id": "test_reindex_doc_s02", "title": "세부내용", "level": 3, "parent_section_id": "test_reindex_doc_s01", "page_range": [2, 2], "parent_chunk_ids": [], "child_chunk_ids": []},
            ],
            "parent_chunks": [
                {"parent_chunk_id": "test_reindex_doc_p001", "id": "test_reindex_doc_p001", "section_id": "test_reindex_doc_s01", "title": "개요 문맥", "text": "텍스트", "token_estimate": 10, "child_chunk_ids": ["test_reindex_doc_c001"], "page_range": [1, 1]}
            ],
            "child_chunks": [
                {"chunk_id": "test_reindex_doc_c001", "parent_chunk_id": "test_reindex_doc_p001", "section_id": "test_reindex_doc_s01", "chunk_type": "paragraph", "text": "단락", "token_estimate": 5, "page_number": 1, "breadcrumbs": []}
            ]
        }
        reindexed = HierarchicalChunker.reindex_etl_result(etl_res)

        # Re-index 후 sections level과 breadcrumbs 검증
        sec_root = reindexed["sections"][0]
        sec1 = reindexed["sections"][1]
        sec2 = reindexed["sections"][2]

        self.assertEqual(sec_root["level"], 0)
        self.assertEqual(sec1["level"], 1)  # H1으로 교정됨
        self.assertEqual(sec1["breadcrumbs"], ["가이드라인", "개요"])
        self.assertEqual(sec2["level"], 2)  # H2로 교정됨
        self.assertEqual(sec2["breadcrumbs"], ["가이드라인", "개요", "세부내용"])

        # Child chunk breadcrumbs도 동기화되었는지 검증
        child = reindexed["child_chunks"][0]
        self.assertEqual(child["breadcrumbs"], ["가이드라인", "개요"])

    def test_reindex_container_section_page_range_and_order(self):
        """
        직속 청크가 없고 하위 자식 섹션만 있는 컨테이너 섹션이
        초기 page_range=[1, 1]로 잘못되어 있더라도,
        하위 섹션들의 page_range([11, 15])를 상향식으로 반영하여
        I, II, III 뒤에 올바른 순서로 재정렬되는지 검증합니다.
        """
        etl_res = {
            "doc_id": "container_test",
            "doc_title": "컨테이너테스트",
            "strategy": "general",
            "sections": [
                {"id": "doc_s00", "title": "루트", "level": 0},
                {"id": "doc_s02", "title": "I. 목적", "level": 1, "parent_section_id": "doc_s00", "page_range": [3, 3], "parent_chunk_ids": [], "child_chunk_ids": ["c01"]},
                {"id": "doc_s03", "title": "II. 주요내용", "level": 1, "parent_section_id": "doc_s00", "page_range": [3, 3], "parent_chunk_ids": [], "child_chunk_ids": ["c02"]},
                {"id": "doc_s04", "title": "III. 적용기준", "level": 1, "parent_section_id": "doc_s00", "page_range": [5, 5], "parent_chunk_ids": [], "child_chunk_ids": ["c03"]},
                # IV는 직속 청크 없이 page_range=[1, 1]로 잘못 지정된 상태
                {"id": "doc_s01", "title": "IV. 조사 및 판정절차", "level": 1, "parent_section_id": "doc_s00", "page_range": [1, 1], "parent_chunk_ids": [], "child_chunk_ids": []},
                {"id": "doc_s07", "title": "1. 재해조사 절차", "level": 2, "parent_section_id": "doc_s01", "page_range": [11, 11], "parent_chunk_ids": [], "child_chunk_ids": ["c04"]},
                {"id": "doc_s08", "title": "2. 판정절차", "level": 2, "parent_section_id": "doc_s01", "page_range": [14, 15], "parent_chunk_ids": [], "child_chunk_ids": ["c05"]},
            ],
            "parent_chunks": [],
            "child_chunks": [
                {"chunk_id": "c01", "section_id": "doc_s02", "page_number": 3, "text": "목적 내용"},
                {"chunk_id": "c02", "section_id": "doc_s03", "page_number": 3, "text": "주요 내용"},
                {"chunk_id": "c03", "section_id": "doc_s04", "page_number": 5, "text": "적용 내용"},
                {"chunk_id": "c04", "section_id": "doc_s07", "page_number": 11, "text": "조사 내용"},
                {"chunk_id": "c05", "section_id": "doc_s08", "page_number": 14, "page_end": 15, "text": "판정 내용"},
            ]
        }
        reindexed = HierarchicalChunker.reindex_etl_result(etl_res)
        sec_titles = [s["title"] for s in reindexed["sections"]]

        # IV가 1위가 아닌 I, II, III 뒤에 올바르게 배치되었는지 검증
        self.assertEqual(sec_titles, [
            "루트",
            "I. 목적",
            "II. 주요내용",
            "III. 적용기준",
            "IV. 조사 및 판정절차",
            "1. 재해조사 절차",
            "2. 판정절차"
        ])

        # IV 섹션의 page_range가 하위 섹션 범위를 반영하여 [11, 15]로 동기화되었는지 검증
        iv_sec = next(s for s in reindexed["sections"] if s["title"] == "IV. 조사 및 판정절차")
        self.assertEqual(iv_sec["page_range"], [11, 15])


if __name__ == "__main__":
    unittest.main()


