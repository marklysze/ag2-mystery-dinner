import time


class GameClock:
    def __init__(self, duration_seconds: int = 10 * 60) -> None:
        self.duration = duration_seconds
        self.start_ts = time.time()
        self._expired = False

    def remaining(self) -> int:
        rem = int(self.duration - (time.time() - self.start_ts))
        if rem <= 0:
            self._expired = True
            return 0
        return rem

    @property
    def expired(self) -> bool:
        return self.remaining() == 0

    def reset(self, duration_seconds: int | None = None) -> None:
        if duration_seconds is not None:
            self.duration = duration_seconds
        self.start_ts = time.time()
        self._expired = False


GAME_CLOCK = GameClock()
