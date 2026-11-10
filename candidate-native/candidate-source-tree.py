"""Calculate Git tree identity from byte-verified source records."""

from hashlib import sha1


def tree_hash(rows):
    root = {}
    for row in rows:
        parent = root
        *parts, leaf = row['path'].split('/')
        for part in parts:
            parent = parent.setdefault(part,{})
        assert leaf not in parent
        parent[leaf] = (row['mode'],bytes.fromhex(row['gitBlobSha1']))

    def digest(folder):
        names = sorted(folder,key=lambda name:(name+('/' if isinstance(folder[name],dict) else '')).encode())
        entries = []
        for name in names:
            item = folder[name]
            mode,fingerprint = ('40000',digest(item)) if isinstance(item,dict) else item
            entries.append(f'{mode} {name}\0'.encode()+fingerprint)
        content = b''.join(entries)
        return sha1(f'tree {len(content)}\0'.encode()+content).digest()

    return digest(root).hex()
