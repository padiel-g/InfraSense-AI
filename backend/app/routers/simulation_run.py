from __future__ import annotations

import uuid

from fastapi import APIRouter

from app.schemas.leak_sequence_simulation import LeakSimulationRunIn, LeakSimulationRunOut
from app.services.leak_sequence_simulation import run_leak_sequence_simulation


router = APIRouter()


@router.post("/simulation/run", response_model=LeakSimulationRunOut)
async def run_simulation(payload: LeakSimulationRunIn) -> LeakSimulationRunOut:
    simulation_id = str(uuid.uuid4())
    readings, detection, summary = run_leak_sequence_simulation(
        simulation_id=simulation_id,
        payload=payload,
    )

    return LeakSimulationRunOut(
        simulation_id=simulation_id,
        generated_readings=readings,
        detection_results=detection,
        summary=summary,
    )
