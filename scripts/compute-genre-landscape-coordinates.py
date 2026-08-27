"""
ミュージックランドスケープのジャンル座標を、genre_lineage(派生/影響/クロス
オーバー関係)のグラフからUMAPで一括計算する(ステップ2: 手動アンカーからの
置き換え)。genre_lineageに1本もエッジが無いジャンルはスキップし、アプリ側の
既存の手動アンカー/キーワード推定にフォールバックさせる。

実行方法:
  python3 scripts/compute-genre-landscape-coordinates.py <genre_graph.jsonのパス> <出力jsonのパス>
"""
import json
import sys
import networkx as nx
import numpy as np
from umap import UMAP

RELATION_WEIGHT = {
    'derivation': 1.0,
    'crossover': 0.9,
    'influence': 0.5,
}


def main():
    if len(sys.argv) != 3:
        print('使い方: python3 compute-genre-landscape-coordinates.py <input.json> <output.json>')
        sys.exit(1)

    with open(sys.argv[1], encoding='utf-8') as f:
        data = json.load(f)

    genres = data['genres']
    edges = data['edges']
    id_to_name = {g['id']: g['name'] for g in genres}

    graph = nx.Graph()
    for g in genres:
        graph.add_node(g['id'])
    for e in edges:
        weight = RELATION_WEIGHT.get(e['relation_type'], 0.5)
        # 既存の重みより強い関係が後から来たら上書きする(同じペアに複数エッジが
        # ある場合、最も強い関係を採用する)
        if graph.has_edge(e['parent_genre_id'], e['child_genre_id']):
            existing = graph[e['parent_genre_id']][e['child_genre_id']]['weight']
            weight = max(weight, existing)
        graph.add_edge(e['parent_genre_id'], e['child_genre_id'], weight=weight)

    # エッジを1本も持たないジャンルは埋め込み対象から除外する(何の関係情報も
    # 無いまま無理にUMAPへ入れても意味のある位置にならないため)
    connected_ids = [n for n in graph.nodes if graph.degree(n) > 0]
    print(f'対象ジャンル: {len(connected_ids)}/{len(genres)}件(genre_lineageに1本以上エッジがあるもの)')

    subgraph = graph.subgraph(connected_ids).copy()

    # 距離 = 1/重み(重みが強いほど近い)としてダイクストラで全対最短距離を求める
    for u, v, d in subgraph.edges(data=True):
        d['distance'] = 1.0 / d['weight']

    n = len(connected_ids)
    index_by_id = {gid: i for i, gid in enumerate(connected_ids)}
    dist_matrix = np.full((n, n), fill_value=np.inf)
    np.fill_diagonal(dist_matrix, 0.0)

    lengths = dict(nx.all_pairs_dijkstra_path_length(subgraph, weight='distance'))
    for src, targets in lengths.items():
        i = index_by_id[src]
        for tgt, dist in targets.items():
            j = index_by_id[tgt]
            dist_matrix[i, j] = dist

    # 連結成分をまたいで到達不能なペアは、有限な最大距離の少し外側に固定する
    # (UMAPのprecomputed距離は有限である必要があるため)
    finite_mask = np.isfinite(dist_matrix)
    max_finite = dist_matrix[finite_mask].max() if finite_mask.any() else 1.0
    dist_matrix[~finite_mask] = max_finite * 2

    n_neighbors = max(2, min(15, n - 1))
    reducer = UMAP(n_components=2, metric='precomputed', n_neighbors=n_neighbors, min_dist=0.3, random_state=42)
    embedding = reducer.fit_transform(dist_matrix)

    # 各軸を[-1, 1]におおよそ収まるようmin-max正規化(中心を0に寄せる)
    def normalize(values):
        lo, hi = values.min(), values.max()
        centered = (values - lo) / (hi - lo) * 2 - 1
        return centered

    xs = normalize(embedding[:, 0])
    ys = normalize(embedding[:, 1])

    result = {}
    for i, gid in enumerate(connected_ids):
        result[gid] = {'name': id_to_name.get(gid), 'x': float(xs[i]), 'y': float(ys[i])}

    with open(sys.argv[2], 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f'完了: {len(result)}件の座標を書き出しました -> {sys.argv[2]}')


if __name__ == '__main__':
    main()
