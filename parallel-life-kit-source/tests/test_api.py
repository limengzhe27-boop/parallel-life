"""HTTP contract tests use injected providers; no offline product mode exists."""
from fastapi.testclient import TestClient
import pytest

from parallel_life.api import create_app
from parallel_life.config import Settings
from parallel_life.models import LifeEvent, Profile
from parallel_life.providers import ProviderError
from helpers import FakeProvider, make_branch


@pytest.fixture
def app_client(tmp_path):
    fake = FakeProvider()
    app = create_app(Settings(data_dir=tmp_path, chat_model="test", chat_api_key="SECRET"),
                     fake, fake, start_worker=False)
    app.state.engine.store.put("branch", make_branch())
    with TestClient(app) as client:
        yield app, client, fake


def enter(client):
    return client.post("/api/branches/branch-a/enter", json={
        "user_id": "user-a", "request_id": "enter"})


def test_real_mode_health_has_no_secret(app_client):
    _, client, _ = app_client
    response = client.get("/api/health")
    assert response.json()["mode"] == "live"
    assert "SECRET" not in response.text


def test_enter_and_tenant_boundaries(app_client):
    _, client, _ = app_client
    assert enter(client).status_code == 200
    assert client.get("/api/branches/branch-a?user_id=other").status_code == 404
    assert client.get("/api/branches/branch-a/history?user_id=other").status_code == 404
    assert client.get("/api/branches?user_id=other").json() == {"branches": []}


def test_turn_roundtrip_replay_and_stale_version(app_client):
    _, client, fake = app_client
    enter(client)
    body = {"user_id": "user-a", "request_id": "turn-1", "version": 0,
            "character_id": "a", "text": "我喜欢安静", "conversation_version": 0}
    response = client.post("/api/branches/branch-a/interact", json=body)
    assert response.status_code == 200
    assert response.json()["world"]["version"] == 0
    assert response.json()["conversation"]["revision"] == 1
    count = len(fake.calls)
    assert client.post("/api/branches/branch-a/interact", json=body).json() == response.json()
    assert len(fake.calls) == count
    body["request_id"] = "turn-2"
    assert client.post("/api/branches/branch-a/interact", json=body).status_code == 409


def test_confirmation_versions_and_invalid_dates(app_client):
    app, client, _ = app_client
    profile = Profile(id="p", user_id="user-a", events=[LifeEvent(date="2018-05-01", text="毕业")])
    app.state.engine.store.put("profile", profile)
    body = {"user_id": "user-a", "identity": "学生", "events": [e.model_dump() for e in profile.events]}
    assert client.post("/api/profiles/p/confirm", json=body).json()["revision"] == 1
    assert client.post("/api/profiles/p/confirm", json=body).json()["revision"] == 2
    assert app.state.engine.store.get("profile_version", "p:1", "user-a")["revision"] == 1
    body["events"][0]["date"] = "未知"
    assert client.post("/api/profiles/p/confirm", json=body).status_code == 409


def test_provider_failure_is_explicit_and_sources_survive(app_client):
    app, client, fake = app_client
    fake.handlers["interview"] = ProviderError("provider_http_error", status_code=401)
    response = client.post("/api/interview", json={"user_id": "user-a", "text": "真实输入"})
    assert response.status_code == 502
    assert response.json()["provider_status"] == 401
    assert app.state.engine.store.list("interview_source", "user-a")[0]["text"] == "真实输入"


def test_explicit_edit_cannot_mutate_location_or_knowledge(app_client):
    _, client, _ = app_client
    enter(client)
    good = client.patch("/api/branches/branch-a/characters/a", json={
        "user_id": "user-a", "version": 0, "persona": "温柔且直率"})
    assert good.status_code == 200 and good.json()["version"] == 1
    bad = client.patch("/api/branches/branch-a/characters/a", json={
        "user_id": "user-a", "version": 1, "location": "不存在"})
    assert bad.status_code == 422


def test_cross_origin_post_rejected(app_client):
    _, client, _ = app_client
    response = client.post("/api/interview", headers={"Origin": "https://evil.invalid"},
                           json={"user_id": "user-a", "text": "injected"})
    assert response.status_code == 403


def test_no_advance_without_explicit_choice_and_confirmation(app_client):
    _, client, fake = app_client
    enter(client)
    response = client.post("/api/branches/branch-a/advance", json={
        "user_id": "user-a", "request_id": "adv", "version": 0, "confirmed": False})
    assert response.status_code == 409
    assert not fake.calls


def test_image_and_evidence_owner_checks(app_client):
    _, client, _ = app_client
    enter(client)
    assert client.get("/api/images/absent?user_id=user-a").status_code == 404
    assert client.get("/api/branches/branch-a/evidence/absent?user_id=user-a&character_id=a").status_code == 404


def test_memory_job_manual_retry(app_client):
    app, client, _ = app_client
    enter(client)
    engine = app.state.engine
    job = engine.job("user-a", "branch-a", "a", "memory", {"source_ids": []}, "test")
    job.status, job.attempts = "failed", 3
    engine.store.put("job", job)
    result = client.post(f"/api/jobs/{job.id}/retry", json={"user_id": "user-a"})
    assert result.status_code == 200 and result.json()["status"] == "pending"


def test_conversation_api_scoping_and_voice(app_client):
    _, client, _ = app_client
    enter(client)
    url = '/api/branches/branch-a/conversation'
    assert client.get(url+'?user_id=user-a&character_id=a').json() == {'state': {}}
    assert client.get(url+'?user_id=other&character_id=a').status_code == 404
    assert client.get(url+'?user_id=user-a&character_id=unknown').status_code == 404
    edited = client.patch('/api/branches/branch-a/characters/a', json={
        'user_id':'user-a','version':0,'voice':'说话简短直接'})
    assert edited.status_code == 200
    body={'user_id':'user-a','request_id':'dialogue','version':1,'character_id':'a','text':'今天心情很好'}
    result=client.post('/api/branches/branch-a/interact',json=body)
    assert result.status_code == 200 and result.json()['turn_mode']=='chat'
    assert result.json()['world']['characters'][0]['voice']=='说话简短直接'
    assert client.get(url+'?user_id=user-a&character_id=a').json()['state']['revision']==1
    assert client.get(url+'?user_id=user-a&character_id=b').json() == {'state': {}}


def test_api_failed_reply_discoverable_after_reload_and_retry_only(app_client):
    app, client, fake = app_client
    enter(client)
    fake.handlers['reply']=ProviderError('temporary_reply_failure',status_code=503)
    body={'user_id':'user-a','request_id':'failed-turn','version':0,'character_id':'a','text':'给我发一张站台的图',
          'image_request':'站台'}
    result=client.post('/api/branches/branch-a/interact',json=body).json()
    assert result['reply_status']=='failed' and result['provider_status']==503
    history=client.get('/api/branches/branch-a/history?user_id=user-a').json()
    assert history['turns'][-1]['request_id']=='failed-turn'
    assert history['turns'][-1]['reply_status']=='failed'
    del fake.handlers['reply']
    count=len(fake.calls)
    result=client.post('/api/branches/branch-a/turns/failed-turn/retry',json={'user_id':'user-a'})
    assert result.status_code==200 and result.json()['reply_status']=='done'
    assert not any(task in {'route','decide'} for task,_ in fake.calls[count:])
    assert len([j for j in app.state.engine.store.list('job','user-a','branch-a') if j['kind']=='image'])==1
    assert client.post('/api/branches/branch-a/turns/failed-turn/retry',json={'user_id':'other'}).status_code==404


def test_media_request_validation(app_client):
    _,client,_=app_client
    enter(client)
    body={'user_id':'user-a','request_id':'bad','version':0,'character_id':'a','text':'你好','image_request':''}
    assert client.post('/api/branches/branch-a/interact',json=body).status_code==422
    body['image_request']='当前场景'
    body['conversation_version']=-1
    assert client.post('/api/branches/branch-a/interact',json=body).status_code==422


def test_missing_saved_image_returns_404_instead_of_server_error(app_client):
    app, client, _ = app_client
    enter(client)
    engine = app.state.engine
    world = engine.world('user-a', 'branch-a')
    job = engine.image_job(world, 'a', '场景', 'missing-asset')
    job.status = 'done'; job.result = {'file': 'missing.jpg', 'mime': 'image/jpeg'}
    engine.store.put('job', job)
    response = client.get(f'/api/images/{job.id}?user_id=user-a')
    assert response.status_code == 404
    assert response.json()['detail'] == 'image asset missing'


def test_image_only_is_explicit_tool_operation_without_fake_role_ack(app_client):
    app, client, provider = app_client
    enter(client)
    body = {'user_id':'user-a','request_id':'only-image','version':0,'character_id':'a',
            'text':'给我发图','image_request':'工作室','image_only':True}
    response = client.post('/api/branches/branch-a/interact',json=body)
    result = response.json()
    assert response.status_code == 200 and result['reply_status'] == 'not_requested'
    assert result['reply_attempts'] == 0 and result['media']['status'] == 'queued'
    assert all(task not in {'route','reply','dialogue_review','decide'} for task,_ in provider.calls)
    assert result['world']['version'] == 0 and len(result['messages']) == 1
    assert client.post('/api/branches/branch-a/interact',json=body).json() == result
    assert client.post('/api/branches/branch-a/turns/only-image/retry',json={'user_id':'user-a'}).json()==result
    assert all(task != 'reply' for task,_ in provider.calls)


def test_image_only_requires_explicit_image_field(app_client):
    _, client, _ = app_client
    enter(client)
    response = client.post('/api/branches/branch-a/interact', json={'user_id':'user-a','request_id':'bad-image',
        'version':0,'character_id':'a','text':'你好','image_only':True})
    assert response.status_code==409
