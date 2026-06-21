from ikarus.scenarios import email_scenario, pdf_scenario, SCENARIOS


def test_email_scenario_has_injection_in_inbox():
    s = email_scenario()
    assert s.attacker_address in s.inbox_text
    assert s.attacker_address not in s.request  # injection is NOT in the trusted request


def test_canonical_plan_recipient_is_trusted_source():
    s = email_scenario()
    sink = [st for st in s.canonical_plan.steps if st.kind == "sink"][0]
    assert sink.args["to"].from_ == "request"


def test_tainted_plan_recipient_comes_from_step():
    s = email_scenario()
    sink = [st for st in s.tainted_plan.steps if st.kind == "sink"][0]
    assert sink.args["to"].from_ == "step"


def test_registry_of_scenarios():
    assert set(SCENARIOS) == {"email", "pdf"}
    assert pdf_scenario().attacker_address in pdf_scenario().inbox_text


def test_addresses_overridable_for_real_sends(monkeypatch):
    # So a live demo delivers to the operator's own inbox, not bob@corp.com.
    monkeypatch.setenv("IKARUS_TRUSTED_RECIPIENT", "me@gmail.com")
    monkeypatch.setenv("IKARUS_ATTACKER_ADDR", "me+attacker@gmail.com")
    s = email_scenario()
    assert s.trusted_recipient == "me@gmail.com"
    assert s.request_values["recipient"].value == "me@gmail.com"
    assert s.attacker_address == "me+attacker@gmail.com"
    assert "me+attacker@gmail.com" in s.inbox_text
