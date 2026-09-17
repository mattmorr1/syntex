"""Self-check for project sharing. Run: python test_sharing.py"""
import asyncio

from api.services.firestore import db_service, can_access, is_owner

OWNER, MEMBER, STRANGER = "uid_owner", "uid_member", "uid_stranger"


def test_access_truth_table():
    owned = {"user_id": OWNER}
    shared = {"user_id": OWNER, "member_uids": [MEMBER]}
    assert can_access(owned, OWNER) and not can_access(owned, MEMBER)
    assert can_access(shared, OWNER) and can_access(shared, MEMBER)
    assert not can_access(shared, STRANGER)
    assert is_owner(shared, OWNER) and not is_owner(shared, MEMBER)
    # A project predating sharing has no member_uids at all.
    assert not can_access({"user_id": OWNER}, MEMBER)


async def make_project():
    project = await db_service.create_project(
        uid=OWNER, name="Paper", theme="report",
        files=[{"name": "main.tex", "content": "x", "type": "tex"}], main_file="main.tex",
    )
    return project["id"]


def run(coro):
    return asyncio.run(coro)


def test_member_gains_read_and_write_but_not_destruction():
    async def scenario():
        pid = await make_project()
        assert await db_service.get_project(pid, MEMBER) is None, "unshared must stay closed"

        assert await db_service.add_project_member(pid, OWNER, MEMBER) == "ok"
        assert await db_service.get_project(pid, MEMBER) is not None

        # The write path is gated independently of the read path.
        result = await db_service.update_project(pid, MEMBER, [{"name": "main.tex",
                                                               "content": "edited",
                                                               "type": "tex"}])
        assert result["ok"], "a member must be able to edit"

        assert not await db_service.update_project_name(pid, MEMBER, "Renamed")
        assert not await db_service.delete_project(pid, MEMBER)
        assert not await db_service.set_project_placement(pid, MEMBER, folder="theirs")

        project = await db_service.get_project(pid, OWNER)
        assert project["name"] == "Paper" and project["folder"] == ""
    run(scenario())


def test_stranger_is_refused_by_the_write_path_too():
    async def scenario():
        pid = await make_project()
        await db_service.add_project_member(pid, OWNER, MEMBER)
        result = await db_service.update_project(pid, STRANGER, [])
        assert not result["ok"] and result["reason"] == "not_found"
    run(scenario())


def test_only_the_owner_shares():
    async def scenario():
        pid = await make_project()
        await db_service.add_project_member(pid, OWNER, MEMBER)
        assert await db_service.add_project_member(pid, MEMBER, STRANGER) == "not_owner"
        assert await db_service.get_project(pid, STRANGER) is None
    run(scenario())


def test_owner_is_never_a_member():
    async def scenario():
        pid = await make_project()
        assert await db_service.add_project_member(pid, OWNER, OWNER) == "is_owner"
        project = await db_service.get_project(pid, OWNER)
        assert OWNER not in (project.get("member_uids") or [])
    run(scenario())


def test_member_may_remove_only_themselves():
    async def scenario():
        pid = await make_project()
        await db_service.add_project_member(pid, OWNER, MEMBER)
        await db_service.add_project_member(pid, OWNER, STRANGER)
        assert await db_service.remove_project_member(pid, MEMBER, STRANGER) == "forbidden"
        assert await db_service.remove_project_member(pid, MEMBER, MEMBER) == "ok"
        assert await db_service.get_project(pid, MEMBER) is None
        assert await db_service.remove_project_member(pid, OWNER, STRANGER) == "ok"
    run(scenario())


def test_membership_is_not_writable_through_a_content_write():
    async def scenario():
        pid = await make_project()
        await db_service.update_project(pid, OWNER, [{"name": "main.tex", "content": "y",
                                                     "type": "tex", "member_uids": [STRANGER]}])
        project = await db_service.get_project(pid, OWNER)
        assert (project.get("member_uids") or []) == [], "no content path may widen access"
        assert await db_service.get_project(pid, STRANGER) is None
    run(scenario())


def test_listing_shows_a_shared_project_once():
    async def scenario():
        pid = await make_project()
        await db_service.add_project_member(pid, OWNER, MEMBER)
        listed = await db_service.get_user_projects(MEMBER)
        assert [p["id"] for p in listed].count(pid) == 1
        assert all(p["user_id"] == OWNER for p in listed if p["id"] == pid), \
            "the client needs user_id to tell owned from shared"
    run(scenario())


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn(); print("ok", name)
