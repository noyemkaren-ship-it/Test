const GLOSSARY = [
  { term: 'Граф знаний', def: 'Знание один раз; формы ссылаются на объекты.', nodeIds: ['core'] },
  { term: 'Control Knowledge', def: 'КС, DELTA, контрольные отчёты.', nodeIds: ['ctrl'] },
  { term: 'ODS Knowledge', def: 'Модель данных и lineage.', nodeIds: ['ods', 'a-ods'] },
  { term: 'Reporting Knowledge', def: 'Формы отчётности, пилот 0409101.', nodeIds: ['rep', 'a-f101'] },
  { term: 'Regulatory Knowledge', def: '809-П, 6406-У, ФЛК.', nodeIds: ['reg'] },
  { term: 'Interest Scope', def: 'Вычисляемая область интересов Actor.', nodeIds: ['core', 'aian'] },
  { term: 'Actor', def: 'Human | AIAgent | Service | ExternalSystem.', nodeIds: ['econ', 'aian'] },
  { term: 'Synthetic Stand', def: 'Проверка знаний на синтетике.', nodeIds: ['stand'] },
  { term: 'КС / ФЛК', def: 'Контрольные соотношения и контроль ЦБ.', nodeIds: ['ctrl', 'reg', 'a-f101'] },
  { term: '0409101', def: 'Оборотная ведомость — пилот.', nodeIds: ['rep', 'a-f101', 's1'] },
  { term: 'Pipe', def: 'Поток изменения; не жёстко в онтологии.', nodeIds: ['core'] },
  { term: 'Инженер ИИ', def: 'Модель знаний, eval, перенос.', nodeIds: ['aian', 'p-aian'] },
  { term: 'Экономист', def: 'Сдаёт форму, отвечает за результат.', nodeIds: ['econ', 'a-econ'] }
]

export default function Glossary({ onSelect, activeIds }: { onSelect: (ids: string[]) => void; activeIds: string[] }) {
  return (
    <div className="panel">
      <h3>Глоссарий</h3>
      <p className="sub-hint">Клик по термину подсвечивает связанные узлы на графе</p>
      <div className="gloss-list">
        {GLOSSARY.map(g => {
          const on = g.nodeIds.some(id => activeIds?.includes(id))
          return (
            <button key={g.term} type="button" className={`gloss-item ${on ? 'on' : ''}`} onClick={() => onSelect(g.nodeIds)}>
              <strong>{g.term}</strong>
              <span>{g.def}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
