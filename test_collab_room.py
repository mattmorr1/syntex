"""Self-check for the collaboration room transition. Run: python test_collab_room.py"""
from api.services.firestore import FirestoreService, PRESENCE_TTL_SECONDS

advance = FirestoreService._advance_collab_room


def test_empty_room_seeds():
    res, room = advance(None, {}, 1000.0, 7, 0.0, None, {"name": "a"})
    assert res["seed"] is True and res["snapshot"] is None and res["updates"] == []
    assert room["presence"]["7"]["name"] == "a"


def test_second_client_does_not_seed_and_sees_the_first():
    _, room = advance(None, {}, 1000.0, 7, 0.0, "AAA", {"name": "a"})
    res, room = advance(None, room, 1001.0, 8, 0.0, None, {"name": "b"})
    assert res["seed"] is False
    assert res["updates"] == ["AAA"]
    assert [p["clientId"] for p in res["peers"]] == [7]


def test_own_update_is_not_echoed_back():
    _, room = advance(None, {}, 1000.0, 7, 0.0, None, {"name": "a"})
    res, _ = advance(None, room, 1001.0, 8, 0.0, "BBB", {"name": "b"})
    assert res["updates"] == []


def test_incremental_since_skips_what_the_client_already_has():
    _, room = advance(None, {}, 1000.0, 7, 0.0, "OLD", {"name": "a"})
    _, room = advance(None, room, 1050.0, 8, 0.0, "NEW", {"name": "b"})
    res, _ = advance(None, room, 1051.0, 7, 1049.0, None, {"name": "a"})
    assert res["updates"] == ["NEW"]


def test_room_resets_once_every_peer_has_lapsed():
    _, room = advance(None, {}, 1000.0, 7, 0.0, "OLD", {"name": "a"})
    later = 1000.0 + PRESENCE_TTL_SECONDS + 1
    res, room = advance(None, room, later, 9, 0.0, None, {"name": "c"})
    assert res["seed"] is True and res["updates"] == [] and room["deltas"] == []


def test_snapshot_only_goes_to_a_fresh_joiner():
    _, room = advance(None, {}, 1000.0, 7, 0.0, None, {"name": "a"})
    room["snapshot"], room["snapshot_ts"] = "SNAP", 999.0
    fresh, _ = advance(None, room, 1001.0, 8, 0.0, None, {"name": "b"})
    resumed, _ = advance(None, room, 1001.0, 8, 1000.5, None, {"name": "b"})
    assert fresh["snapshot"] == "SNAP" and resumed["snapshot"] is None


def test_solo_session_keeps_its_room_between_ticks():
    res, room = advance(None, {}, 1000.0, 7, 0.0, "SEED", {"name": "a"})
    assert res["seed"] is True
    res, room = advance(None, room, 1001.0, 7, 1000.0, None, {"name": "a"})
    assert res["seed"] is False, "a lone client must not reseed every tick"
    assert room["deltas"] and room["deltas"][0]["data"] == "SEED"


def test_joiner_receives_what_a_solo_client_typed():
    _, room = advance(None, {}, 1000.0, 7, 0.0, "SEED", {"name": "a"})
    _, room = advance(None, room, 1001.0, 7, 1000.0, None, {"name": "a"})
    res, _ = advance(None, room, 1002.0, 8, 0.0, None, {"name": "b"})
    assert res["seed"] is False and res["updates"] == ["SEED"]


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn(); print("ok", name)
