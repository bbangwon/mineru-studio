import logging
import unicodedata
import uuid
from typing import Any, Dict, List, Optional, Tuple, Union

from qdrant_client import QdrantClient, models
from qdrant_client.http.exceptions import UnexpectedResponse

from rag_embed_core.config import QdrantConfig
from rag_embed_core.models import HybridSearchResult, SparseVector

logger = logging.getLogger(__name__)


def to_valid_qdrant_id(id_val: Union[str, int]) -> str:
    """문자열 ID를 Qdrant 표준 UUID(v5) 규격으로 결정론적 변환합니다."""
    if isinstance(id_val, int):
        return str(id_val)
    try:
        # 이미 유효한 UUID 형식인지 확인
        uuid_obj = uuid.UUID(str(id_val))
        return str(uuid_obj)
    except ValueError:
        # 일반 문자열 ID는 DNS 네임스페이스 기반 UUID v5로 결정론적 변환
        return str(uuid.uuid5(uuid.NAMESPACE_DNS, str(id_val)))


class QdrantManager:
    """Qdrant 벡터 데이터베이스 연결 및 하이브리드 컬렉션 제어 매니저.

    - 로컬 내장(Embedded) 모드 및 원격(Remote Server) 모드 완벽 지원
    - Qdrant Modifier.IDF 적용 희소 벡터 및 BGE-M3 Dense 벡터 하이브리드 인덱싱
    - Reciprocal Rank Fusion(Fusion.RRF) 융합 검색
    """

    def __init__(self, config: Optional[QdrantConfig] = None, client: Optional[QdrantClient] = None):
        self.config = config or QdrantConfig()
        self._client = client

    def get_client(self) -> QdrantClient:
        """설정에 따른 Qdrant 클라이언트 인스턴스를 반환합니다."""
        if self._client is not None:
            return self._client

        if self.config.mode == "embedded":
            logger.info(f"Qdrant Embedded 모드로 클라이언트 초기화 (경로: {self.config.local_path})")
            self._client = QdrantClient(path=self.config.local_path, check_compatibility=False)
        else:
            logger.info(f"Qdrant Remote 모드로 클라이언트 초기화 (URL: {self.config.url})")
            self._client = QdrantClient(
                url=self.config.url,
                api_key=self.config.api_key,
                timeout=10,
                check_compatibility=False,
            )
        return self._client

    def test_connection(self) -> Dict[str, Any]:
        """Qdrant 연결 상태 및 컬렉션 현황을 테스트합니다."""
        try:
            client = self.get_client()
            collections_res = client.get_collections()
            collection_names = [c.name for c in collections_res.collections]
            return {
                "success": True,
                "mode": self.config.mode,
                "target": self.config.local_path if self.config.mode == "embedded" else self.config.url,
                "collections": collection_names,
                "collections_count": len(collection_names),
                "message": f"연결 성공 ({self.config.mode} 모드, 컬렉션 {len(collection_names)}개 감지)",
            }
        except Exception as e:
            logger.error(f"Qdrant 연결 실패: {e}")
            return {
                "success": False,
                "mode": self.config.mode,
                "target": self.config.local_path if self.config.mode == "embedded" else self.config.url,
                "error": str(e),
                "message": f"연결 실패: {e}",
            }

    def init_collection(
        self,
        collection_name: Optional[str] = None,
        recreate: Optional[bool] = None,
    ) -> bool:
        """하이브리드 검색 컬렉션을 생성하거나 기존 컬렉션을 확인합니다."""
        client = self.get_client()
        col_name = collection_name or self.config.collection_name
        should_recreate = recreate if recreate is not None else self.config.recreate_collection

        # 기존 컬렉션 존재 여부 확인
        exists = client.collection_exists(col_name)

        if exists and should_recreate:
            logger.info(f"기존 컬렉션 삭제 후 재생성: {col_name}")
            client.delete_collection(col_name)
            exists = False

        if not exists:
            dense_name = getattr(self.config, "dense_vector_name", "dense") or "dense"
            sparse_name = getattr(self.config, "sparse_vector_name", "sparse") or "sparse"
            logger.info(
                f"신규 하이브리드 컬렉션 생성: {col_name} "
                f"(Dense '{dense_name}' {self.config.dense_dim}차원 + Sparse '{sparse_name}' Modifier.IDF)"
            )
            client.create_collection(
                collection_name=col_name,
                vectors_config={
                    dense_name: models.VectorParams(
                        size=self.config.dense_dim,
                        distance=models.Distance.COSINE,
                    )
                },
                sparse_vectors_config={
                    sparse_name: models.SparseVectorParams(
                        modifier=models.Modifier.IDF,  # Qdrant 서버사이드 IDF 자동 연산
                    )
                },
            )
            return True

        return False

    def upsert_points(
        self,
        points: List[Dict[str, Any]],
        collection_name: Optional[str] = None,
        batch_size: Optional[int] = None,
    ) -> int:
        """Dense 및 Sparse 벡터를 포함한 데이터 포인트를 Qdrant에 적재합니다.

        각 point 딕셔너리 기대 구조:
        {
            "id": str 또는 int,
            "dense_vector": List[float],
            "sparse_vector": SparseVector 또는 {"indices": [...], "values": [...]},
            "payload": dict
        }
        """
        if not points:
            return 0

        client = self.get_client()
        col_name = collection_name or self.config.collection_name
        self.init_collection(col_name, recreate=False)

        dense_name = getattr(self.config, "dense_vector_name", "dense") or "dense"
        sparse_name = getattr(self.config, "sparse_vector_name", "sparse") or "sparse"

        bsize = batch_size or self.config.batch_size
        total_upserted = 0

        for i in range(0, len(points), bsize):
            batch = points[i : i + bsize]
            qdrant_points: List[models.PointStruct] = []

            for item in batch:
                raw_id = item.get("id") or item.get("chunk_id") or str(uuid.uuid4())
                point_id = to_valid_qdrant_id(raw_id)

                dense_vec = item.get("dense_vector", [])
                sparse_raw = item.get("sparse_vector")

                if isinstance(sparse_raw, SparseVector):
                    sparse_indices = sparse_raw.indices
                    sparse_values = sparse_raw.values
                elif isinstance(sparse_raw, dict):
                    sparse_indices = sparse_raw.get("indices", [])
                    sparse_values = sparse_raw.get("values", [])
                else:
                    sparse_indices = []
                    sparse_values = []

                payload = dict(item.get("payload") or {})
                # 원본 chunk_id 보존
                if "chunk_id" not in payload:
                    payload["chunk_id"] = str(raw_id)

                qdrant_points.append(
                    models.PointStruct(
                        id=point_id,
                        vector={
                            dense_name: dense_vec,
                            sparse_name: models.SparseVector(
                                indices=sparse_indices,
                                values=sparse_values,
                            ),
                        },
                        payload=payload,
                    )
                )

            client.upsert(collection_name=col_name, points=qdrant_points)
            total_upserted += len(qdrant_points)

        return total_upserted

    def search_hybrid(
        self,
        query_dense: List[float],
        query_sparse: SparseVector,
        limit: int = 10,
        collection_name: Optional[str] = None,
        query_filter: Optional[models.Filter] = None,
    ) -> List[HybridSearchResult]:
        """Qdrant 네이티브 Prefetch 및 Fusion.RRF(Reciprocal Rank Fusion)를 활용한 하이브리드 검색을 수행합니다."""
        client = self.get_client()
        col_name = collection_name or self.config.collection_name

        if not client.collection_exists(col_name):
            msg = f"Qdrant 컬렉션 '{col_name}'이(가) 존재하지 않습니다. Qdrant 설정의 컬렉션 이름을 확인하거나 먼저 인덱싱을 수행해주세요."
            logger.warning(msg)
            raise ValueError(msg)

        dense_name = getattr(self.config, "dense_vector_name", "dense") or "dense"
        sparse_name = getattr(self.config, "sparse_vector_name", "sparse") or "sparse"

        prefetch_limit = max(limit * 2, 20)

        prefetch_list = []
        # Sparse prefetch (indices가 있는 경우에만)
        if query_sparse.indices:
            prefetch_list.append(
                models.Prefetch(
                    query=models.SparseVector(
                        indices=query_sparse.indices,
                        values=query_sparse.values,
                    ),
                    using=sparse_name,
                    limit=prefetch_limit,
                    filter=query_filter,
                )
            )

        # Dense prefetch (dense vector가 있는 경우)
        if query_dense and any(v != 0.0 for v in query_dense):
            prefetch_list.append(
                models.Prefetch(
                    query=query_dense,
                    using=dense_name,
                    limit=prefetch_limit,
                    filter=query_filter,
                )
            )

        # 둘 다 없으면 빈 결과 반환
        if not prefetch_list:
            return []

        response = client.query_points(
            collection_name=col_name,
            prefetch=prefetch_list,
            query=models.FusionQuery(fusion=models.Fusion.RRF),
            limit=limit,
        )

        results: List[HybridSearchResult] = []
        for pt in response.points:
            payload = pt.payload or {}
            orig_id = payload.get("chunk_id", str(pt.id))
            results.append(
                HybridSearchResult(
                    id=orig_id,
                    score=float(pt.score),
                    payload=payload,
                )
            )

        return results

    def delete_by_doc_id(
        self,
        doc_name: str,
        collection_name: Optional[str] = None,
    ) -> bool:
        """특정 doc_id, doc_title, breadcrumbs를 가진 포인트를 컬렉션에서 삭제합니다."""
        client = self.get_client()
        col_name = collection_name or self.config.collection_name
        try:
            if not client.collection_exists(col_name):
                return False

            client.delete(
                collection_name=col_name,
                points_selector=models.FilterSelector(
                    filter=models.Filter(
                        should=[
                            models.FieldCondition(key="doc_id", match=models.MatchValue(value=doc_name)),
                            models.FieldCondition(key="doc_title", match=models.MatchValue(value=doc_name)),
                            models.FieldCondition(key="breadcrumbs", match=models.MatchValue(value=doc_name)),
                        ]
                    )
                ),
            )
            logger.info(f"Qdrant 컬렉션 '{col_name}'에서 문서 '{doc_name}' 포인트 삭제 완료")
            return True
        except Exception as e:
            logger.warning(f"Qdrant 포인트 삭제 실패 (문서: {doc_name}): {e}")
            return False

    def get_indexed_docs_summary(
        self, collection_name: Optional[str] = None
    ) -> Tuple[Dict[str, Dict[str, Any]], List[str]]:
        """컬렉션에 적재된 문서별 청크 수 요약(NFC 정규화) 및 매칭용 식별자 목록을 반환합니다."""
        client = self.get_client()
        col_name = collection_name or self.config.collection_name
        try:
            if not client.collection_exists(col_name):
                return {}, []

            doc_summary: Dict[str, Dict[str, Any]] = {}
            doc_names: set[str] = set()
            offset = None
            while True:
                records, next_offset = client.scroll(
                    collection_name=col_name,
                    limit=250,
                    offset=offset,
                    with_payload=["breadcrumbs", "doc_id", "doc_title", "title", "chunk_id"],
                    with_vectors=False,
                )
                for r in records:
                    p = r.payload or {}

                    # 1. 주 문서 식별자 결정 (doc_title -> breadcrumbs[0] -> title -> doc_id 순)
                    primary_name = None
                    dt = p.get("doc_title")
                    if dt and str(dt).strip():
                        primary_name = str(dt).strip()
                    if not primary_name:
                        bc = p.get("breadcrumbs")
                        if bc and isinstance(bc, list) and len(bc) > 0 and str(bc[0]).strip():
                            primary_name = str(bc[0]).strip()
                    if not primary_name:
                        title = p.get("title")
                        if title and str(title).strip():
                            primary_name = str(title).strip()
                    if not primary_name:
                        doc_id = p.get("doc_id")
                        if doc_id and str(doc_id).strip():
                            primary_name = str(doc_id).strip()

                    if primary_name:
                        norm_primary = unicodedata.normalize("NFC", primary_name)
                        if norm_primary not in doc_summary:
                            doc_summary[norm_primary] = {
                                "doc_id": norm_primary,
                                "chunks_count": 0,
                                "doc_title": norm_primary,
                            }
                        doc_summary[norm_primary]["chunks_count"] += 1

                    # 2. 매칭용 별칭/식별자 수집 (NFC 정규화)
                    for val in [p.get("doc_title"), p.get("title"), p.get("doc_id")]:
                        if val and str(val).strip():
                            doc_names.add(unicodedata.normalize("NFC", str(val).strip()))
                    bc = p.get("breadcrumbs")
                    if bc and isinstance(bc, list) and len(bc) > 0 and str(bc[0]).strip():
                        doc_names.add(unicodedata.normalize("NFC", str(bc[0]).strip()))
                    cid = p.get("chunk_id", "")
                    if cid and "_c" in cid:
                        doc_names.add(unicodedata.normalize("NFC", cid.rsplit("_c", 1)[0].strip()))

                if next_offset is None:
                    break
                offset = next_offset

            return doc_summary, sorted(list(doc_names))
        except Exception as e:
            logger.warning(f"Qdrant 색인 문서 집계 조회 실패 ({col_name}): {e}")
            raise e

    def get_indexed_doc_names(self, collection_name: Optional[str] = None) -> List[str]:
        """컬렉션에 저장된 문서 식별자(breadcrumbs[0], doc_id, title, chunk_id 접두사 등) 목록을 조회합니다."""
        _, doc_names = self.get_indexed_docs_summary(collection_name)
        return doc_names

    def get_collection_info(self, collection_name: Optional[str] = None) -> Dict[str, Any]:
        """컬렉션 통계 정보(포인트 수 등)를 반환합니다."""
        client = self.get_client()
        col_name = collection_name or self.config.collection_name
        try:
            info = client.get_collection(col_name)
            return {
                "collection_name": col_name,
                "points_count": info.points_count,
                "indexed_vectors_count": info.indexed_vectors_count,
                "status": str(info.status),
            }
        except Exception as e:
            return {
                "collection_name": col_name,
                "error": str(e),
            }
