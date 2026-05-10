"""Tests for app.clock.GameClock using pytest monkeypatch to control time.time().

API notes (from inspection of app/clock.py):
- remaining()  → int method
- elapsed()    → int method
- expired      → bool property (returns False when clock is frozen)
- freeze()     → method; locks remaining at current value
- reset()      → method; restores full duration, clears freeze, resets elapsed
"""

import app.clock as clock_module
from app.clock import GameClock

DURATION = 120  # seconds, chosen to be simple and not depend on GAME_DURATION_SECONDS


def _make_fake_time(start: float):
    """Return a mutable fake time callable whose value can be advanced."""
    state = {"now": start}

    def fake_time():
        return state["now"]

    def advance(seconds: float):
        state["now"] += seconds

    fake_time.advance = advance  # type: ignore[attr-defined]
    return fake_time


# ---------------------------------------------------------------------------
# A004 – initial state immediately after construction
# ---------------------------------------------------------------------------

def test_initial_state(monkeypatch):
    """Freshly constructed GameClock: remaining == duration, elapsed == 0, expired is False."""
    fake = _make_fake_time(1000.0)
    monkeypatch.setattr(clock_module.time, "time", fake)

    gc = GameClock(duration_seconds=DURATION)

    assert gc.remaining() == DURATION, "remaining() should equal full duration at t=0"
    assert gc.elapsed() == 0, "elapsed() should be 0 at t=0"
    assert gc.expired is False, "expired should be False at t=0"


# ---------------------------------------------------------------------------
# A005 – remaining() decreases as mocked time advances
# ---------------------------------------------------------------------------

def test_remaining_decreases(monkeypatch):
    """remaining() counts down correctly as mocked time advances."""
    fake = _make_fake_time(1000.0)
    monkeypatch.setattr(clock_module.time, "time", fake)

    gc = GameClock(duration_seconds=DURATION)

    fake.advance(30)
    assert gc.remaining() == DURATION - 30

    fake.advance(45)
    assert gc.remaining() == DURATION - 75

    fake.advance(20)
    assert gc.remaining() == DURATION - 95


# ---------------------------------------------------------------------------
# A006 – elapsed() returns correct elapsed seconds
# ---------------------------------------------------------------------------

def test_elapsed(monkeypatch):
    """elapsed() returns the number of seconds that have passed since construction."""
    fake = _make_fake_time(5000.0)
    monkeypatch.setattr(clock_module.time, "time", fake)

    gc = GameClock(duration_seconds=DURATION)

    fake.advance(50)
    assert gc.elapsed() == 50

    fake.advance(30)
    assert gc.elapsed() == 80


# ---------------------------------------------------------------------------
# A007 – expired transitions from False to True once time crosses duration
# ---------------------------------------------------------------------------

def test_expired_transitions(monkeypatch):
    """expired is False before the deadline and True once mocked time passes it."""
    fake = _make_fake_time(0.0)
    monkeypatch.setattr(clock_module.time, "time", fake)

    gc = GameClock(duration_seconds=DURATION)

    assert gc.expired is False, "expired should be False before the deadline"

    # Advance to just before the boundary
    fake.advance(DURATION - 1)
    assert gc.expired is False, "expired should still be False 1 second before deadline"

    # Cross the boundary
    fake.advance(1)  # now exactly at duration
    assert gc.expired is True, "expired should be True once time == duration"

    fake.advance(10)  # well past the deadline
    assert gc.expired is True, "expired should stay True past the deadline"


# ---------------------------------------------------------------------------
# A008 – freeze() locks remaining so further time advances don't change it
# ---------------------------------------------------------------------------

def test_freeze_locks_remaining(monkeypatch):
    """After freeze(), remaining() returns the same value regardless of time advances."""
    fake = _make_fake_time(0.0)
    monkeypatch.setattr(clock_module.time, "time", fake)

    gc = GameClock(duration_seconds=DURATION)

    fake.advance(40)
    frozen_value = gc.remaining()  # should be DURATION - 40 = 80
    assert frozen_value == DURATION - 40

    gc.freeze()

    # Advance time further; remaining() must stay at the frozen value
    fake.advance(20)
    assert gc.remaining() == frozen_value, "remaining() should not change after freeze()"

    fake.advance(100)
    assert gc.remaining() == frozen_value, "remaining() should still be frozen after large advance"


# ---------------------------------------------------------------------------
# A009 – reset() restores the clock to full duration, zero elapsed, expired=False
# ---------------------------------------------------------------------------

def test_reset_restores_clock(monkeypatch):
    """reset() brings remaining back to full duration, elapsed to 0, expired to False."""
    fake = _make_fake_time(0.0)
    monkeypatch.setattr(clock_module.time, "time", fake)

    gc = GameClock(duration_seconds=DURATION)

    # Run the clock past expiry
    fake.advance(DURATION + 10)
    assert gc.expired is True, "precondition: clock should have expired"

    # Reset and verify state is restored
    gc.reset()

    assert gc.remaining() == DURATION, "remaining() should equal full duration after reset()"
    assert gc.elapsed() == 0, "elapsed() should be 0 immediately after reset()"
    assert gc.expired is False, "expired should be False immediately after reset()"


def test_reset_also_clears_freeze(monkeypatch):
    """reset() unfreezes the clock so remaining() again responds to time advances."""
    fake = _make_fake_time(0.0)
    monkeypatch.setattr(clock_module.time, "time", fake)

    gc = GameClock(duration_seconds=DURATION)

    fake.advance(30)
    gc.freeze()
    assert gc.remaining() == DURATION - 30  # frozen at 90

    gc.reset()

    # After reset, clock should be live again at full duration
    assert gc.remaining() == DURATION
    assert gc.elapsed() == 0

    # And it should count down normally
    fake.advance(15)
    assert gc.remaining() == DURATION - 15
