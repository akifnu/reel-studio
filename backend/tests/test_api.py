import copy
from dataclasses import replace
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
import json
import httpx
from pydantic import ValidationError

from fastapi.testclient import TestClient
from studio.config import Settings
from studio.app import create_app
from studio.demo import seed
from studio.planning import quick_edit, suggest, propose


class API(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="studio-api-")
        root = Path(cls.temp.name)
        cls.settings = Settings(Settings.load().pipeline, root/"data", root/"ui", token="test-only-key")
        with patch.dict(os.environ, {"STUDIO_ALLOWED_HOSTS": "testserver"}):
            cls.app = create_app(cls.settings)
        cls.p = cls.app.state.pipeline
        if cls.p is None:
            raise RuntimeError(cls.app.state.settings)
        cls.jid = seed(cls.p)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.client.headers["Authorization"] = "Bearer test-only-key"

    def get(self):
        result = self.client.get(f"/api/projects/{self.jid}")
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def settled_task(self, response):
        self.assertIn(response.status_code, (201,202), response.text)
        task=response.json()["task_id"]
        deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            result=self.client.get("/api/tasks/"+task).json()
            if result["status"] in ("succeeded","failed"):
                self.assertEqual(result["status"],"succeeded",result)
                return
            time.sleep(.01)
        self.fail("Task did not settle")

    def test_health_and_cookie_login_protect_media_and_api(self):
        detail = self.get()
        url = detail["reels"][0]["frames"][0]["url"]
        self.client.headers.pop("Authorization")
        self.assertEqual(self.client.get("/api/health").status_code, 200)
        self.assertEqual(self.client.get("/api/projects").status_code, 401)
        self.assertEqual(self.client.get(url).status_code, 401)
        self.assertEqual(self.client.post("/api/session", json={"token":"wrong"}).status_code, 401)
        self.assertEqual(self.client.post("/api/session", json={"token":"test-only-key"}).status_code, 200)
        self.assertEqual(self.client.get(url).status_code, 200)
        self.assertEqual(self.client.post("/api/projects",headers={"Origin":"https://attacker.example"},json={}).status_code,403)

    def test_video_range_and_gif_urls_are_real_files(self):
        detail = self.get()
        source = detail["sources"]["A"]["url"]
        response = self.client.get(source, headers={"Range":"bytes=0-99"})
        self.assertEqual(response.status_code,206)
        self.assertEqual(len(response.content),100)
        self.assertIn("bytes 0-99/",response.headers["content-range"])
        gif = self.client.get(detail["reels"][0]["gif"]["url"])
        self.assertEqual(gif.status_code,200)
        self.assertTrue(gif.content.startswith(b"GIF89a"))
        self.assertNotIn("/tmp/", str(detail["sources"]))

    def test_approval_requires_the_current_board(self):
        detail=self.get();n=detail["needs"]
        result=self.client.post(f"/api/projects/{self.jid}/approve",json={"need_id":n["need_id"],"revision":n["revision"],"sha256":"0"*64})
        self.assertEqual(result.status_code,409,result.text)
        self.assertIsNone(self.p.job(self.jid)["storyboard_approval"])
        self.assertEqual(self.client.get(f"/api/projects/{self.jid}/export").status_code,409)

    def test_opaque_media_registry_cannot_escape_the_data_root(self):
        url=self.p.db.media(self.jid,"/etc/passwd")
        self.assertEqual(self.client.get(url).status_code,404)
        self.assertEqual(self.client.get("/api/media/../../etc/passwd").status_code,404)

    def test_invalid_edits_do_not_change_the_accepted_generation(self):
        detail=self.get()
        for changes in ({"editing":{"crop":{"zoom":999}}},{"editing":{"captions":{"style":{"size":999999}}}},
                        {"editing":{"music":{"gain_db":80}}},{"segments":[{"src":"MISSING","sentences":[0,0]}]}):
            response=self.client.patch(f"/api/projects/{self.jid}/reels/r01",json={"generation":detail["generation"],"revision":detail["revision"],"changes":changes})
            self.assertEqual(response.status_code,422,response.text)
            self.assertEqual(self.p.job(self.jid)["plan_generation"],detail["generation"])

    def test_stale_tab_cannot_edit_or_comment(self):
        detail=self.get()
        response=self.client.patch(f"/api/projects/{self.jid}/reels/r01",json={"generation":detail["generation"]+1,"revision":detail["revision"],"changes":{"cta":"stale"}})
        self.assertEqual(response.status_code,409,response.text)
        response=self.client.post(f"/api/projects/{self.jid}/comments",json={"reel_id":"r01","generation":999,"time":.2,"text":"old"})
        self.assertEqual(response.status_code,409)

    def test_comments_persist_and_resolve_without_mutating_the_plan(self):
        detail=self.get()
        response=self.client.post(f"/api/projects/{self.jid}/comments",json={"reel_id":"r01","generation":detail["generation"],"time":.3,"text":"Move the caption up here."})
        self.assertEqual(response.status_code,201,response.text)
        cid=response.json()["id"]
        self.assertEqual(self.get()["comments"][-1]["text"],"Move the caption up here.")
        self.assertEqual(self.client.patch(f"/api/projects/{self.jid}/comments/{cid}",json={"resolved":True}).status_code,200)
        self.assertTrue(self.get()["comments"][-1]["resolved"])
        self.assertEqual(self.get()["generation"],detail["generation"])

    def test_proposals_are_validated_and_never_auto_apply(self):
        detail=self.get()
        response=self.client.post(f"/api/projects/{self.jid}/propose",json={"reel_id":"r01","generation":detail["generation"],"text":"Yellow captions and zoom to 1.2"})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()["changes"]["editing"]["crop"]["zoom"],1.2)
        self.assertEqual(self.get()["generation"],detail["generation"])
        self.assertIsNone(self.p.job(self.jid)["storyboard_approval"])

    def test_local_imports_and_unknown_provider_urls_are_rejected(self):
        for url in ("http://127.0.0.1:8000/secret", "file:///etc/passwd", "https://youtube.com.attacker.test/a", "https://attacker.test/video"):
            self.assertEqual(self.client.post("/api/imports",json={"url":url}).status_code,422)

    def test_missing_files_and_invalid_uploads_fail_cleanly(self):
        response=self.client.post("/api/projects",json={"name":"Bad","sources":["missing"]})
        self.assertEqual(response.status_code,422)
        response=self.client.post("/api/uploads",data={"role":"source"},files={"file":("bad.mp4",b"broken media","video/mp4")})
        self.assertEqual(response.status_code,422,response.text)

    def test_upload_and_create_a_preset_project_without_faking_style_analysis(self):
        asset=self.p.assets.get(self.p.job(self.jid)["inputs"]["sources"][0])
        with asset.path.open("rb") as file:
            response=self.client.post("/api/uploads",data={"role":"source"},files={"file":("source.mp4",file,"video/mp4")})
        self.assertEqual(response.status_code,201,response.text)
        upload=response.json()["id"]
        with patch.object(self.p.o,"start",return_value={"acknowledged":True}):
            response=self.client.post("/api/projects",json={"name":"A real upload flow","sources":[upload],"preset":"bold","count":2,"duration":15})
            self.settled_task(response)
        job=self.p.job(response.json()["id"])
        self.assertTrue(job["steps"]["verify_style"]["done"])
        self.assertFalse(job["steps"].get("transcribe",{}).get("done"))
        self.assertEqual(job["plan_generation"],0)
        self.assertTrue((self.p.db.get("project",job["id"]) or {})["demo"])

    def test_reference_and_raw_inputs_keep_their_roles_and_style_brief(self):
        asset = self.p.assets.get(self.p.job(self.jid)["inputs"]["sources"][0])
        ids = {}
        for role in ("source", "sample"):
            with asset.path.open("rb") as file:
                response = self.client.post("/api/uploads", data={"role": role},
                                            files={"file": (role + ".mp4", file, "video/mp4")})
            self.assertEqual(response.status_code, 201, response.text)
            ids[role] = response.json()["id"]
        with patch.object(self.p.o, "start", return_value={"acknowledged": True}):
            response = self.client.post("/api/projects", json={"name": "Reference + raw", "sources": [ids["source"]],
                "sample": ids["sample"], "reference_notes": "Fast cuts and a question hook", "count": 1, "duration": 5})
            self.settled_task(response)
        jid = response.json()["id"]
        job = self.p.job(jid)
        self.assertFalse(job["steps"].get("analyze", {}).get("done"))
        detail = self.p.detail(jid)
        self.assertEqual(detail["reference"]["notes"], "Fast cuts and a question hook")
        self.assertEqual(detail["reference"]["name"], "sample.mp4")
        self.assertEqual(len(detail["sources"]), 1)
        self.assertEqual(detail["sources"]["A"]["name"], "source.mp4")
        self.assertIn("Reference style brief: Fast cuts and a question hook", self.p.o._rq(job)["notes"])
        for payload in ({"name": "Wrong raw", "sources": [ids["sample"]]},
                        {"name": "Wrong reference", "sources": [ids["source"]], "sample": ids["source"]}):
            result = self.client.post("/api/projects", json=payload)
            self.assertEqual(result.status_code, 422, result.text)

    def test_adding_music_updates_the_plan_and_withdraws_approval(self):
        jid=seed(self.p,preview=True,name="Music regression")
        detail=self.p.detail(jid)
        asset=self.p.assets.get(self.p.job(jid)["inputs"]["sources"][0])
        upload="music-test"
        self.p.db.put("upload",upload,{"id":upload,"asset":asset.id,"name":"Music","role":"music","bytes":100})
        with patch.object(self.p.o,"start",return_value={"acknowledged":True}):
            response=self.client.post(f"/api/projects/{jid}/music",json={"upload_id":upload,"generation":detail["generation"],"revision":detail["revision"]})
            self.settled_task(response)
        job=self.p.job(jid)
        plan=self.p.fs.read_json(job["plan"]["path"])
        self.assertEqual(plan["music"]["asset"],asset.id)
        self.assertEqual(job["plan_generation"],detail["generation"]+1)
        self.assertIsNone(job["storyboard_approval"])
        response=self.client.post("/api/uploads",data={"role":"source"},files={"file":("bad.txt",b"x","text/plain")})
        self.assertEqual(response.status_code,422)

    def test_edit_updates_only_one_reel_and_rejects_the_old_approval(self):
        # Use a fresh project so test ordering never affects the shared preview.
        jid=seed(self.p,preview=True,name="Edit regression")
        self.client.get(f"/api/projects/{jid}")
        before=self.p.detail(jid);n=before["needs"]
        changes={"editing":{"captions":{"style":{"fill":"#ffe600","size":64}},"crop":{"zoom":1.2,"x":.6,"y":.5}},
                 "caption_text":{"A:0":"A corrected sentence, ready to preview."}}
        with patch.object(self.p.o,"start",return_value={"acknowledged":True}):
            response=self.client.patch(f"/api/projects/{jid}/reels/r01",json={"generation":before["generation"],"revision":before["revision"],"changes":changes})
            self.assertEqual(response.status_code,202,response.text)
            self.settled_task(response)
        after=self.p.o.advance(jid)
        self.assertEqual(after["status"],"needs:approve_storyboard",after.get("error"))
        self.assertEqual(after["storyboard"]["cache_hits"],1)
        detail=self.p.detail(jid)
        self.assertEqual(detail["reels"][0]["effective_style"]["captions"]["style"]["fill"],"#ffe600")
        self.assertIn("corrected",detail["reels"][0]["speech"])
        self.assertTrue(detail["reels"][0]["caption_events"])
        self.assertNotEqual(detail["reels"][0]["frames"][0]["url"],before["reels"][0]["frames"][0]["url"])
        response=self.client.post(f"/api/projects/{jid}/approve",json={"need_id":n["need_id"],"revision":n["revision"],"sha256":n["storyboard_sha256"]})
        self.assertEqual(response.status_code,409,response.text)
        with patch.object(self.p.o,"start",return_value={"acknowledged":True}):
            response=self.client.post(f"/api/projects/{jid}/undo",json={"generation":detail["generation"],"revision":detail["revision"],"changes":{}})
            self.settled_task(response)
        undone=self.p.o.advance(jid)
        self.assertEqual(undone["storyboard"]["cache_hits"],2)
        self.assertIsNone(undone["storyboard_approval"])


class Planning(unittest.TestCase):
    def test_suggestions_preserve_sentences_and_do_not_reuse_them(self):
        tr={"A":{"sentences":[{"id":i,"s":i*2,"e":i*2+1.9,"text":f"A complete thought {i}."} for i in range(12)]}}
        plan={"reels":[],"sources":{"A":"asset"}}
        out=suggest(plan,tr,3,6)
        seen=set()
        for reel in out["reels"]:
            a,b=reel["segments"][0]["sentences"]
            self.assertFalse(seen.intersection(range(a,b+1)))
            seen.update(range(a,b+1))
        self.assertEqual(plan["reels"],[])

    def test_unknown_instructions_do_not_pretend_to_be_applied(self):
        self.assertIsNone(quick_edit("Make the story more emotional"))
        self.assertIsNone(quick_edit("Don't mute the music"))
        self.assertEqual(quick_edit("mute music")["editing"]["music"],{"muted":True})

    def test_provider_proposals_are_bounded_and_cannot_include_privileged_actions(self):
        settings=Settings(Path("/unused"),Path("/unused"),Path("/unused"),ai_key="test-provider-key",ai_url="https://provider.example/v1")
        factory=httpx.Client
        answer={"changes":{"cta":"A new closing line"},"explanation":"Change the ending."}
        def transport(request):
            body=json.loads(request.content)
            self.assertEqual(body["max_tokens"],1500)
            self.assertEqual(body["response_format"],{"type":"json_object"})
            return httpx.Response(200,json={"choices":[{"message":{"content":json.dumps(answer)}}]})
        with patch("studio.planning.httpx.Client",side_effect=lambda **kwargs:factory(transport=httpx.MockTransport(transport),**kwargs)):
            result=propose("Give this reel a stronger closing line",{"id":"r01"},settings)
            self.assertEqual(result["changes"],{"cta":"A new closing line"})
            answer["changes"]={"approve":True,"render":True}
            with self.assertRaises(ValidationError):
                propose("Give this reel a stronger closing line",{"id":"r01"},settings)


if __name__=="__main__":unittest.main()
