import os
from datetime import datetime
from sqlalchemy import create_engine, Column, String, Integer, DateTime, ForeignKey, Text, Float
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./sentinelops.db")

# Use SQLite compatible arguments if using SQLite
connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class Incident(Base):
    __tablename__ = "incidents"

    id = Column(String, primary_key=True, index=True) # e.g. INC-2026-102
    service = Column(String, index=True)
    alert_name = Column(String)
    status = Column(String, default="INVESTIGATING") # INVESTIGATING, EXECUTING_FIX, VERIFYING, RESOLVED, FAILED
    severity = Column(String)
    root_cause = Column(Text, nullable=True)
    confidence = Column(Integer, nullable=True)          # 0-100 confidence score from RCA
    risk_level = Column(String, nullable=True)            # LOW / MEDIUM / HIGH
    evidence = Column(Text, nullable=True)                # JSON string: list of evidence items
    affected_services = Column(Text, nullable=True)       # JSON string: list of service names
    reasoning_summary = Column(Text, nullable=True)       # LLM reasoning narrative
    resolution_action = Column(Text, nullable=True)
    resolution_time_seconds = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    logs = relationship("IncidentLog", back_populates="incident", cascade="all, delete-orphan")

class IncidentLog(Base):
    __tablename__ = "incident_logs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    incident_id = Column(String, ForeignKey("incidents.id", ondelete="CASCADE"), index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    level = Column(String, default="INFO") # INFO, WARNING, ERROR, AGENT_THOUGHT, AGENT_ACTION, AGENT_RESULT
    message = Column(Text)

    incident = relationship("Incident", back_populates="logs")

def init_db():
    Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
