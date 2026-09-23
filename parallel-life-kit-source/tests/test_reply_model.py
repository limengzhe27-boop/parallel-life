"""Routing contract tests only; not evidence of live Character access/quality."""
import json

from fastapi.testclient import TestClient
import httpx
import pytest

from helpers import FakeProvider
from parallel_life.api import create_app
from parallel_life.config import Settings
from parallel_life.providers import OpenAICompatibleProvider, ProviderError, TASKS
from test_providers import PNG, settings


def test_reply_model_env_is_optional(monkeypatch):
    monkeypatch.setenv("PARALLEL_LIFE_CHAT_MODEL", "chat")
    monkeypatch.delenv("PARALLEL_LIFE_REPLY_MODEL", raising=False)
    monkeypatch.delenv("PARALLEL_LIFE_MEMORY_MODEL", raising=False)
    assert Settings.from_env().reply_model == ""
    monkeypatch.setenv("PARALLEL_LIFE_REPLY_MODEL", "character")
    configured = Settings.from_env()
    assert configured.reply_model == "character"
    assert configured.chat_model == configured.memory_model == "chat"


@pytest.mark.parametrize("reply_model", ["", "doubao-seed-character-260628", "ep-test"])
@pytest.mark.parametrize("image_prompt", [None, "角色当前场景的插图"])
async def test_reply_routes_only_model_and_preserves_image_contract(reply_model, image_prompt):
    calls = []
    reply = {"text": "test reply", "image_prompt": image_prompt}

    def handle(request):
        calls.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(reply)}}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        provider = OpenAICompatibleProvider(settings(reply_model=reply_model), client=client)
        result = await provider.json("reply", {"input": "current input", "context": {}})
    assert result == reply
    assert len(calls) == 1
    request = calls[0]
    payload = json.loads(request.content)
    assert payload["model"] == (reply_model or "test-chat")
    assert payload["response_format"] == {"type": "json_object"}
    assert payload["messages"][-2] == {"role": "user", "content": "current input"}
    assert request.url.host == "model.example"
    assert request.headers["authorization"] == "Bearer SECRET_TEST_KEY"


@pytest.mark.parametrize("task", [name for name in TASKS if name != "reply"])
async def test_reply_setting_leaves_other_tasks_on_chat(task):
    calls = []

    def handle(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "{}"}}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        await OpenAICompatibleProvider(settings(reply_model="character"), client=client).json(task, {})
    assert calls[0]["model"] == "test-chat"


@pytest.mark.parametrize("task", ["memory", "summary", "reply"])
async def test_memory_provider_is_never_rerouted(task):
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": "{}"}}]})

    config = settings(reply_model="character", memory_base_url="https://memory.example/v1",
                      memory_api_key="SECRET_MEMORY", memory_model="memory")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        await OpenAICompatibleProvider(config, role="memory", client=client).json(task, {})
    assert json.loads(calls[0].content)["model"] == "memory"
    assert calls[0].url.host == "memory.example"
    assert calls[0].headers["authorization"] == "Bearer SECRET_MEMORY"


async def test_reply_override_leaves_images_unchanged():
    import base64
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(PNG).decode()}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        result = await OpenAICompatibleProvider(settings(reply_model="character"), client=client).image("image")
    assert result == (PNG, "image/png")
    assert json.loads(calls[0].content)["model"] == "test-image"
    assert calls[0].headers["authorization"] == "Bearer SECRET_IMAGE_KEY"


@pytest.mark.parametrize("status", [400, 404, 429, 500])
async def test_character_failure_is_not_retried_or_replaced(status):
    calls = []

    def handle(request):
        calls.append(json.loads(request.content)["model"])
        return httpx.Response(status, text="SECRET_TEST_KEY")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        with pytest.raises(ProviderError) as error:
            await OpenAICompatibleProvider(settings(reply_model="character"), client=client).json("reply", {})
    assert error.value.status_code == status
    assert "SECRET" not in str(error.value)
    assert calls == ["character"]


@pytest.mark.parametrize("reply_model", ["", "character"])
def test_health_exposes_effective_reply_model_without_live_probe(tmp_path, reply_model):
    fake = FakeProvider()
    app = create_app(settings(data_dir=tmp_path, reply_model=reply_model), fake, fake, start_worker=False)
    with TestClient(app) as client:
        result = client.get("/api/health")
    assert result.json()["reply_model"] == (reply_model or "test-chat")
    assert "SECRET" not in result.text
    assert fake.calls == []


@pytest.mark.parametrize("reply_model", ["", "doubao-seed-character-260628", "ep-test"])
async def test_plain_reply_has_own_model_and_no_tool_or_json_obligation(reply_model):
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": "  一句自然台词。  "}}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        result = await OpenAICompatibleProvider(settings(reply_model=reply_model), client=client).reply(
            {"input": "聊聊吧", "context": {}, "media": {"status": "queued", "subject": "窗景"}})
    assert result == "一句自然台词。"
    assert len(calls) == 1
    payload = json.loads(calls[0].content)
    assert payload["model"] == (reply_model or "test-chat")
    assert "response_format" not in payload and "tools" not in payload
    assert "image_prompt" not in str(payload)
    assert payload["messages"][-2] == {"role": "user", "content": "聊聊吧"}
    assert payload["messages"][-1]["role"] == "system"
    assert calls[0].url.host == "model.example"
    assert calls[0].headers["authorization"] == "Bearer SECRET_TEST_KEY"


async def test_plain_reply_uses_chat_credentials_even_on_memory_adapter():
    calls = []
    config = settings(reply_model="character", memory_base_url="https://memory.example/v1",
                      memory_api_key="SECRET_MEMORY", memory_model="memory")

    def handle(request):
        calls.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": "台词"}}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        assert await OpenAICompatibleProvider(config, role="memory", client=client).reply({}) == "台词"
    assert calls[0].url.host == "model.example"
    assert calls[0].headers["authorization"] == "Bearer SECRET_TEST_KEY"
    assert json.loads(calls[0].content)["model"] == "character"


@pytest.mark.parametrize("model", ["doubao-seed-character-260628", "doubao-seed-2-0-lite-260215"])
async def test_plain_ark_reply_explicitly_disables_thinking(model):
    calls = []

    def handle(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "台词"}}]})

    config = settings(chat_base_url="https://ark.cn-beijing.volces.com/api/v3", reply_model=model)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        await OpenAICompatibleProvider(config, client=client).reply({})
    assert calls[0]["thinking"] == {"type": "disabled"}


@pytest.mark.parametrize("status", [400, 401, 429, 500])
async def test_plain_reply_failure_is_sanitized_without_retry_or_model_fallback(status):
    calls = []

    def handle(request):
        calls.append(json.loads(request.content)["model"])
        return httpx.Response(status, text="SECRET_TEST_KEY private-proxy-details")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        with pytest.raises(ProviderError) as error:
            await OpenAICompatibleProvider(settings(reply_model="character"), client=client).reply({})
    assert error.value.status_code == status
    assert "SECRET" not in str(error.value) and "private-proxy" not in str(error.value)
    assert calls == ["character"]


@pytest.mark.parametrize("body", [{}, {"choices": []}, {"choices": [{"message": {"content": None}}]},
    {"choices": [{"message": {"content": []}}]}, {"choices": [{"message": {"content": " \n "}}]}])
async def test_plain_reply_requires_nonempty_text(body):
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=body))) as client:
        with pytest.raises(ProviderError, match="invalid_provider_reply"):
            await OpenAICompatibleProvider(settings(), client=client).reply({})


async def test_plain_reply_transport_error_is_uncertain_and_not_retried():
    calls = []

    def handle(request):
        calls.append(request)
        raise httpx.ReadTimeout("SECRET_TEST_KEY private endpoint")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        with pytest.raises(ProviderError) as error:
            await OpenAICompatibleProvider(settings(), client=client).reply({})
    assert error.value.uncertain and error.value.code == "provider_transport_error"
    assert "SECRET" not in str(error.value) and len(calls) == 1
