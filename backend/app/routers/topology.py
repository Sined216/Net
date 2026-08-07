from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app import models, schemas

router = APIRouter(tags=["topology"])


@router.get("/topology", response_model=schemas.TopologyOut)
def get_topology(site_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(models.Device).options(joinedload(models.Device.device_type))
    if site_id is not None:
        q = q.filter(models.Device.site_id == site_id)
    devices = q.all()

    nodes = [
        schemas.TopologyNode(
            id=d.id, code=d.code, name=d.name,
            device_type=d.device_type.name if d.device_type else "",
            site_id=d.site_id,
        )
        for d in devices
    ]
    device_ids = {d.id for d in devices}

    links = (
        db.query(models.Link)
        .options(
            joinedload(models.Link.interface_a),
            joinedload(models.Link.interface_b),
        )
        .all()
    )

    edges = []
    for link in links:
        dev_a = link.interface_a.device_id
        dev_b = link.interface_b.device_id
        if site_id is not None and (dev_a not in device_ids or dev_b not in device_ids):
            continue
        edges.append(
            schemas.TopologyEdge(
                link_id=link.id,
                device_a_id=dev_a,
                device_b_id=dev_b,
                interface_a_label=link.interface_a.label,
                interface_b_label=link.interface_b.label,
                media_type=link.media_type,
                confirmed=link.confirmed,
            )
        )

    return schemas.TopologyOut(nodes=nodes, edges=edges)
