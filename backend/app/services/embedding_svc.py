import json
import logging
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

# 패키지 경로를 sys.path에 등록하여 서브프로세스 및 uvicorn 환경 호환 보장
_PKG_ROOT = Path(__file__).resolve().parent.parent.parent.parent / "packages" / "rag_embed_core"
if _PKG_ROOT.exists() and str(_PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(_PKG_ROOT))

from rag_embed_core import (
    DenseEncoder,
    KiwiSparseEncoder,
    QdrantConfig,
    QdrantManager,
    SparseVector,
)
from backend.app.services.qdrant_config_svc import get_qdrant_config

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent
OUTPUT_DIR = BASE_DIR / "output"
INDEXED_DOCS_MANIFEST_PATH = OUTPUT_DIR / "qdrant_indexed_docs.json"


def load_indexed_docs_manifest() -> Dict[str, Any]:
    """Qdrant에 적재된 문서 메타데이터 매니페스트(초경량 JSON) 로드"""
    if INDEXED_DOCS_MANIFEST_PATH.exists():
        try:
            with open(INDEXED_DOCS_MANIFEST_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"인덱스 매니페스트 로드 실패: {e}")
    return {"collection_name": "", "documents": {}, "last_synced_at": ""}


def save_indexed_docs_manifest(data: Dict[str, Any]) -> None:
    """Qdrant 적재 문서 메타데이터 매니페스트 영속화"""
    try:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        with open(INDEXED_DOCS_MANIFEST_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.warning(f"인덱스 매니페스트 저장 실패: {e}")

# 싱글톤 인코더 캐시
_kiwi_encoder: Optional[KiwiSparseEncoder] = None
_dense_encoder: Optional[DenseEncoder] = None


def get_sparse_encoder() -> KiwiSparseEncoder:
    global _kiwi_encoder
    if _kiwi_encoder is None:
        logger.info("KiwiSparseEncoder 싱글톤 인스턴스 초기화")
        _kiwi_encoder = KiwiSparseEncoder()
    return _kiwi_encoder


def get_dense_encoder(config: Optional[QdrantConfig] = None) -> DenseEncoder:
    global _dense_encoder
    cfg = config or get_qdrant_config()
    if _dense_encoder is None or _dense_encoder.model_name != cfg.dense_model_name:
        logger.info(f"DenseEncoder 싱글톤 인스턴스 초기화 (모델: {cfg.dense_model_name})")
        _dense_encoder = DenseEncoder(
            model_name=cfg.dense_model_name,
            device=cfg.device,
            lazy_load=True,
        )
    return _dense_encoder


class EmbeddingService:
    """ETL 청크 하이브리드 임베딩 및 Qdrant 색인/검색 오케스트레이션 서비스"""

    def __init__(self):
        pass

    def get_manager(self, config: Optional[QdrantConfig] = None) -> QdrantManager:
        cfg = config or get_qdrant_config()
        return QdrantManager(config=cfg)

    def test_connection(self, config: Optional[QdrantConfig] = None) -> Dict[str, Any]:
        manager = self.get_manager(config)
        return manager.test_connection()

    def get_indexed_doc_names_with_fallback(
        self,
        config: Optional[QdrantConfig] = None,
    ) -> Tuple[Set[str], Dict[str, Any]]:
        """Qdrant에서 실제 색인된 문서 식별자 목록을 실시간 조회하며,
        Qdrant 설정 오류/접속 불가 시 로컬 매니페스트 캐시로 안전하게 fallback 처리합니다."""
        cfg = config or get_qdrant_config()
        target_col = cfg.collection_name
        manifest = load_indexed_docs_manifest()

        # 1. Qdrant 직접 실시간 조회 시도
        try:
            manager = self.get_manager(cfg)
            live_doc_summary, live_names = manager.get_indexed_docs_summary(collection_name=target_col)

            # 컬렉션 변경 감지: 매니페스트의 컬렉션과 현재 조회 컬렉션이 다르면 이전 컬렉션 문서 격리
            old_col = manifest.get("collection_name")
            old_docs = manifest.get("documents", {}) if old_col == target_col else {}

            # 양방향 동기화 (Prune & Sync): 현재 Qdrant에 존재하는 문서들만 매니페스트에 보존/갱신
            synced_docs = {}
            for doc_name, info in live_doc_summary.items():
                norm_key = unicodedata.normalize("NFC", doc_name)
                existing = old_docs.get(norm_key) or old_docs.get(doc_name) or {}
                synced_docs[norm_key] = {
                    "doc_id": norm_key,
                    "chunks_count": info.get("chunks_count", 0),
                    "indexed_at": existing.get("indexed_at") or time.strftime("%Y-%m-%d %H:%M:%S"),
                    "collection": target_col,
                    "source": existing.get("source", "qdrant_live_sync"),
                }

            manifest["collection_name"] = target_col
            manifest["documents"] = synced_docs
            manifest["last_synced_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
            save_indexed_docs_manifest(manifest)

            all_valid_names = set(live_names) | set(synced_docs.keys())

            return all_valid_names, {
                "connected": True,
                "mode": cfg.mode,
                "collection": target_col,
                "error": None,
                "used_cache": False,
                "indexed_doc_count": len(synced_docs),
            }
        except Exception as e:
            logger.warning(f"Qdrant 연결/조회 실패 ({e}). 로컬 인덱스 매니페스트 캐시로 fallback 합니다.")

            # 2. 접속 실패 시 로컬 인덱스 매니페스트에서 복원 (컬렉션이 일치할 때만 유효 처리)
            cached_names: Set[str] = set()
            if manifest.get("collection_name") == target_col or not manifest.get("collection_name"):
                cached_names = {unicodedata.normalize("NFC", k) for k in manifest.get("documents", {}).keys()}

            return cached_names, {
                "connected": False,
                "mode": cfg.mode,
                "collection": target_col,
                "error": str(e),
                "used_cache": True,
                "indexed_doc_count": len(cached_names),
            }

    def embed_and_upsert(
        self,
        child_chunks: List[Dict[str, Any]],
        parent_chunks: Optional[List[Dict[str, Any]]] = None,
        config: Optional[QdrantConfig] = None,
        collection_name: Optional[str] = None,
        progress_callback: Optional[Callable[[str, float], None]] = None,
    ) -> Dict[str, Any]:
        """자식 청크 목록을 Dense & Sparse 인코딩하고 Qdrant에 저장합니다."""
        start_time = time.time()
        cfg = config or get_qdrant_config()
        target_col = collection_name or cfg.collection_name
        manager = self.get_manager(cfg)

        if not child_chunks:
            return {
                "success": False,
                "error": "인덱싱할 청크 데이터가 비어 있습니다.",
                "total_chunks": 0,
                "upserted_count": 0,
            }

        # 제외 플래그(is_ignored)가 설정된 청크 필터링
        active_chunks = [c for c in child_chunks if not c.get("is_ignored")]
        if not active_chunks:
            return {
                "success": False,
                "error": "인덱싱 대상 청크가 모두 제외(is_ignored) 상태입니다.",
                "total_chunks": 0,
                "upserted_count": 0,
            }

        if progress_callback:
            progress_callback("형태소 분석 및 Sparse 벡터 생성 중...", 10)

        sparse_enc = get_sparse_encoder()
        dense_enc = get_dense_encoder(cfg)

        # 텍스트 추출 (text 필드 우선, 없을 경우 content 필드)
        texts = [c.get("text") or c.get("content") or "" for c in active_chunks]

        # 1. Sparse 인코딩
        sparse_vecs = sparse_enc.encode_documents(texts)

        if progress_callback:
            progress_callback("Dense 임베딩 모델 로드 및 벡터 추출 중 (BGE-m3-ko)...", 30)

        # 2. Dense 인코딩
        dense_vecs = dense_enc.encode_texts(
            texts,
            batch_size=cfg.batch_size,
            show_progress_bar=False,
        )

        if progress_callback:
            progress_callback(f"Qdrant 컬렉션 준비 및 데이터 적재 중 ({len(active_chunks)}개)...", 70)

        # 부모 청크 매핑 테이블 구성
        parent_map: Dict[str, Dict[str, Any]] = {}
        if parent_chunks:
            for p in parent_chunks:
                pid = p.get("parent_chunk_id") or p.get("id")
                if pid:
                    parent_map[pid] = p

        # 3. Qdrant 포인트 구성
        points: List[Dict[str, Any]] = []

        for i, chunk in enumerate(active_chunks):
            cid = chunk.get("chunk_id") or f"chunk_{i:04d}"
            sp_vec = sparse_vecs[i]
            dn_vec = dense_vecs[i]

            pid = chunk.get("parent_chunk_id") or chunk.get("parent_id") or ""
            # chunk 자체에 parent_text가 있으면 우선 채택, 없으면 parent_map에서 조회
            p_text = chunk.get("parent_text")
            if not p_text and pid and pid in parent_map:
                p_text = parent_map[pid].get("text", "")
            p_text = p_text or ""

            # 페이지 정보 정규화
            page_start = chunk.get("page_number") or chunk.get("page") or 1
            page_end = chunk.get("page_end") or page_start
            page_idx = (page_start - 1) if isinstance(page_start, int) and page_start > 0 else chunk.get("page_idx", 0)

            # 목차/계층 정보 정규화
            breadcrumbs = chunk.get("breadcrumbs") or chunk.get("heading_hierarchy") or []

            # 토큰 수 정규화
            token_count = chunk.get("token_estimate") or chunk.get("token_count") or 0

            chunk_meta = dict(chunk.get("metadata") or {})
            chunk_meta.pop("has_image", None)
            chunk_meta.pop("image_path", None)
            chunk_meta.pop("image_url", None)

            # doc_id 보정 (비어있을 경우 breadcrumbs[0] 또는 chunk_id prefix 활용)
            doc_id_val = chunk.get("doc_id") or ""
            if not doc_id_val:
                if breadcrumbs and isinstance(breadcrumbs, list) and len(breadcrumbs) > 0:
                    doc_id_val = str(breadcrumbs[0]).strip()
                elif "_c" in cid:
                    doc_id_val = cid.rsplit("_c", 1)[0].strip()

            payload = {
                "chunk_id": cid,
                "doc_id": doc_id_val,
                "parent_chunk_id": pid,
                "parent_text": p_text,
                "section_id": chunk.get("section_id", ""),
                "chunk_type": chunk.get("chunk_type", "text"),
                "title": chunk.get("title") or chunk.get("table_caption") or "",
                "page_number": page_start,
                "page_end": page_end,
                "page_idx": page_idx,
                "breadcrumbs": breadcrumbs,
                "heading_hierarchy": breadcrumbs,  # 기존 호환성 유지
                "text": texts[i],
                "token_count": token_count,
                "token_estimate": token_count,
                "char_length": len(texts[i]),
                "raw_html": chunk.get("raw_html"),
                "table_caption": chunk.get("table_caption"),
                "table_footnote": chunk.get("table_footnote"),
                "table_type": chunk.get("table_type"),
                "is_table": bool(chunk.get("is_table") or chunk.get("chunk_type") == "table"),
                "is_atomic_table": bool(chunk.get("is_atomic_table")),
                "metadata": chunk_meta,
            }

            points.append({
                "id": cid,
                "dense_vector": dn_vec,
                "sparse_vector": sp_vec,
                "payload": payload,
            })

        # 컬렉션 생성 (recreate 여부 반영)
        manager.init_collection(target_col, recreate=cfg.recreate_collection)

        # 포인트 업서트
        upserted_count = manager.upsert_points(
            points,
            collection_name=target_col,
            batch_size=cfg.batch_size,
        )

        # 4. 경량 인덱스 매니페스트 갱신 (단일 거대 파일 비대화 방지)
        try:
            manifest = load_indexed_docs_manifest()
            if cfg.recreate_collection or manifest.get("collection_name") != target_col:
                manifest["documents"] = {}

            # 현재 색인된 주 문서명 추출 (doc_title -> breadcrumbs[0] -> doc_id 순)
            primary_doc_name = None
            if active_chunks:
                first_dt = active_chunks[0].get("doc_title")
                if first_dt and str(first_dt).strip():
                    primary_doc_name = str(first_dt).strip()
                if not primary_doc_name:
                    first_bc = active_chunks[0].get("breadcrumbs") or []
                    if first_bc and isinstance(first_bc, list) and len(first_bc) > 0 and str(first_bc[0]).strip():
                        primary_doc_name = str(first_bc[0]).strip()
                if not primary_doc_name:
                    primary_doc_name = active_chunks[0].get("doc_id")

            if not primary_doc_name:
                primary_doc_name = target_col

            norm_primary = unicodedata.normalize("NFC", str(primary_doc_name).strip())
            docs_dict = manifest.get("documents", {})
            docs_dict[norm_primary] = {
                "doc_id": norm_primary,
                "chunks_count": len(points),
                "indexed_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "collection": target_col,
                "source": "embed_upsert",
            }
            manifest["collection_name"] = target_col
            manifest["documents"] = docs_dict
            manifest["last_synced_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
            save_indexed_docs_manifest(manifest)
        except Exception as e:
            logger.warning(f"인덱스 매니페스트 갱신 실패: {e}")

        elapsed = round(time.time() - start_time, 2)

        if progress_callback:
            progress_callback(f"인덱싱 완료! ({upserted_count}개 적재 완료, 소요시간: {elapsed}초)", 100)

        return {
            "success": True,
            "collection_name": target_col,
            "total_chunks": len(child_chunks),
            "upserted_count": upserted_count,
            "elapsed_time": elapsed,
            "dense_dim": len(dense_vecs[0]) if dense_vecs else 0,
        }

    def hybrid_search(
        self,
        query: str,
        limit: int = 10,
        config: Optional[QdrantConfig] = None,
        collection_name: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """사용자 자연어 쿼리로 Qdrant RRF 하이브리드 검색을 수행합니다."""
        if not query or not query.strip():
            return []

        cfg = config or get_qdrant_config()
        manager = self.get_manager(cfg)
        target_col = collection_name or cfg.collection_name

        sparse_enc = get_sparse_encoder()
        dense_enc = get_dense_encoder(cfg)

        q_sparse = sparse_enc.encode_query(query)
        q_dense = dense_enc.encode_text(query)

        search_results = manager.search_hybrid(
            query_dense=q_dense,
            query_sparse=q_sparse,
            limit=limit,
            collection_name=target_col,
        )

        formatted_results: List[Dict[str, Any]] = []
        for rank, res in enumerate(search_results, start=1):
            p = res.payload or {}
            formatted_results.append({
                "rank": rank,
                "id": res.id,
                "score": round(res.score, 6),
                "chunk_id": p.get("chunk_id", res.id),
                "parent_chunk_id": p.get("parent_chunk_id", ""),
                "parent_text": p.get("parent_text", ""),
                "section_id": p.get("section_id", ""),
                "text": p.get("text", ""),
                "title": p.get("title", ""),
                "page_number": p.get("page_number", (p.get("page_idx", 0) + 1)),
                "page_end": p.get("page_end", p.get("page_number", (p.get("page_idx", 0) + 1))),
                "page_idx": p.get("page_idx", 0),
                "chunk_type": p.get("chunk_type", "text"),
                "breadcrumbs": p.get("breadcrumbs") or p.get("heading_hierarchy", []),
                "heading_hierarchy": p.get("heading_hierarchy") or p.get("breadcrumbs", []),
                "token_count": p.get("token_count", 0),
                "token_estimate": p.get("token_estimate", p.get("token_count", 0)),
                "raw_html": p.get("raw_html"),
                "table_caption": p.get("table_caption"),
                "table_footnote": p.get("table_footnote"),
                "is_table": p.get("is_table", False),
                "metadata": p.get("metadata", {}),
                "payload": p,
            })

        return formatted_results

    def delete_document_vectors(
        self,
        doc_name: str,
        config: Optional[QdrantConfig] = None,
        collection_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Qdrant 컬렉션에서 특정 문서의 벡터를 삭제하고 매니페스트를 동기화합니다."""
        cfg = config or get_qdrant_config()
        manager = self.get_manager(cfg)
        target_col = collection_name or cfg.collection_name

        # 1. Qdrant 벡터 포인트 삭제
        qdrant_deleted = False
        try:
            qdrant_deleted = manager.delete_by_doc_id(doc_name, collection_name=target_col)
        except Exception as e:
            logger.warning(f"Qdrant 벡터 포인트 삭제 실패 (문서: {doc_name}): {e}")

        # 2. 로컬 매니페스트에서 해당 문서 삭제
        try:
            manifest = load_indexed_docs_manifest()
            docs_dict = manifest.get("documents", {})
            norm_doc = unicodedata.normalize("NFC", doc_name) if doc_name else ""
            to_remove = [
                k for k in docs_dict
                if unicodedata.normalize("NFC", k) == norm_doc or norm_doc in unicodedata.normalize("NFC", k)
            ]
            for k in to_remove:
                docs_dict.pop(k, None)
            manifest["documents"] = docs_dict
            manifest["last_synced_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
            save_indexed_docs_manifest(manifest)
            logger.info(f"인덱스 매니페스트에서 문서 '{doc_name}' 정리 완료")
        except Exception as e:
            logger.warning(f"매니페스트 문서 정리 실패 (문서: {doc_name}): {e}")

        return {
            "success": True,
            "qdrant_deleted": qdrant_deleted,
        }


embedding_svc = EmbeddingService()
